import * as chains from "../../../../chains";
import { messageFactory } from "../../../../chains/defaults/messages/messageFactory";
import { OptimalTrade, tryAmmArb, tryOrderbookArb } from "../../../arbitrage/arbitrage";
import { getPaths, newGraph } from "../../../arbitrage/graph";
import { OptimalOrderbookTrade } from "../../../arbitrage/optimizers/orderbookOptimizer";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging";
import { BotConfig, ChainConfig } from "../../base/configs";
import { LogType } from "../../base/logging";
import { Orderbook } from "../../base/orderbook";
import { getOrderbookAmmPaths, OrderbookPath, OrderSequence, Path } from "../../base/path";
import { Pool, removedUnusedPools } from "../../base/pool";
import { DexLoopInterface } from "../interfaces/dexloopInterface";
import { DexMempoolLoop } from "./dexMempoolloop";
import { DexMempoolSkipLoop } from "./dexMempoolSkiploop";

/**
 *
 */
export class DexLoop implements DexLoopInterface {
	pools: Array<Pool>;
	orderbooks: Array<Orderbook>;
	paths: Array<Path>; //holds all known paths minus cooldowned paths
	orderbookPaths: Array<OrderbookPath>;
	pathlib: Array<Path>; //holds all known paths
	CDpaths: Map<string, [number, number, number]>; //holds all cooldowned paths' identifiers
	chainOperator: ChainOperator;
	accountNumber = 0;
	sequence = 0;
	chainConfig: ChainConfig;
	botConfig: BotConfig;
	logger: Logger | undefined;
	iterations = 0;
	updatePoolStates: DexLoopInterface["updatePoolStates"];
	updateOrderbookStates?: DexLoopInterface["updateOrderbookStates"];
	messageFactory: DexLoopInterface["messageFactory"];
	ammArb: (paths: Array<Path>, chainConfig: ChainConfig) => OptimalTrade | undefined;
	orderbookArb: (paths: Array<OrderbookPath>, chainConfig: ChainConfig) => OptimalOrderbookTrade | undefined;

	/**
	 *
	 */
	public constructor(
		chainOperator: ChainOperator,
		chainConfig: ChainConfig,
		botConfig: BotConfig,
		logger: Logger | undefined,
		allPools: Array<Pool>,
		orderbooks: Array<Orderbook>,
		updatePoolStates: DexLoopInterface["updatePoolStates"],
		messageFactory: DexLoopInterface["messageFactory"],
		updateOrderbookStates?: DexLoopInterface["updateOrderbookStates"],
	) {
		const graph = newGraph(allPools);
		const paths = getPaths(graph, chainConfig.offerAssetInfo, botConfig.maxPathPools) ?? [];
		const filteredPools = removedUnusedPools(allPools, paths);
		const orderbookPaths = getOrderbookAmmPaths(allPools, orderbooks);

		this.orderbookPaths = orderbookPaths;
		this.orderbooks = orderbooks;
		this.pools = filteredPools;
		this.CDpaths = new Map<string, [number, number, number]>();
		this.paths = paths;
		this.pathlib = paths;
		this.ammArb = tryAmmArb;
		this.orderbookArb = tryOrderbookArb;
		this.updatePoolStates = updatePoolStates;
		this.updateOrderbookStates = updateOrderbookStates;
		this.messageFactory = messageFactory;
		this.chainOperator = chainOperator;
		this.botConfig = botConfig;
		this.chainConfig = chainConfig;
		this.logger = logger;
	}
	/**
	 *
	 */
	static async createLoop(botConfig: BotConfig, chainConfig: ChainConfig, logger: Logger): Promise<DexLoopInterface> {
		const msgFactory = chains.defaults.messageFactory;
		let getPoolStates = chains.defaults.getPoolStates;
		let initPools = chains.defaults.initPools;
		const initOrderbook = chains.injective.initOrderbooks;
		const getOrderbookState = chains.injective.getOrderbookState;
		await import("../../../../chains/" + chainConfig.chainPrefix).then(async (chainSetups) => {
			if (chainSetups === undefined) {
				await logger.sendMessage("Unable to resolve specific chain imports, using defaults", LogType.Console);
			}
			// msgFactory = chainSetups.getFlashArbMessages;
			getPoolStates = chainSetups.getPoolStates;
			initPools = chainSetups.initPools;
			return;
		});
		const orderbooks: Array<Orderbook> = [];
		//spawn chainOperator for chain interaction for each chainconfig//

		const chainOperator = await ChainOperator.connectWithSigner(chainConfig);

		/*******************************/
		if (chainConfig.chainPrefix === "inj" && chainConfig.orderbooks.length > 0) {
			const obs = await initOrderbook(chainOperator, chainConfig);
			if (obs) {
				orderbooks.push(...obs);
			}
		}
		const allPools = await initPools(chainOperator, chainConfig.poolEnvs, chainConfig.mappingFactoryRouter);
		if (botConfig.useMempool && !chainConfig.skipConfig?.useSkip) {
			console.log("spinning up mempool loop");
			return new DexMempoolLoop(
				chainOperator,
				chainConfig,
				botConfig,
				logger,
				allPools,
				orderbooks,
				getPoolStates,
				msgFactory,
				getOrderbookState,
			);
		} else if (botConfig.useMempool && chainConfig.skipConfig?.useSkip) {
			console.log("spinning up skip mempool loop");
			return new DexMempoolSkipLoop(
				chainOperator,
				chainConfig,
				botConfig,
				logger,
				allPools,
				orderbooks,
				getPoolStates,
				msgFactory,
				getOrderbookState,
			);
		}
		console.log("spinning up no-mempool loop");
		return new DexLoop(
			chainOperator,
			chainConfig,
			botConfig,
			logger,
			allPools,
			orderbooks,
			getPoolStates,
			messageFactory,
			getOrderbookState,
		);
	}
	/**
	 *
	 */
	public async step() {
		this.iterations++;

		const arbTrade: OptimalTrade | undefined = this.ammArb(this.paths, this.chainConfig);
		const arbtradeOB = this.orderbookArb(this.orderbookPaths, this.chainConfig);

		if (arbTrade || arbtradeOB) {
			await this.trade(arbTrade, arbtradeOB);
			await this.chainOperator.reset();
		}
	}

	/**
	 *
	 */
	async reset() {
		this.unCDPaths();
		await this.updatePoolStates(this.chainOperator, this.pools);
		if (this.updateOrderbookStates) {
			await this.updateOrderbookStates(this.chainOperator, this.orderbooks);
		}
	}

	/**
	 *
	 */
	public async trade(arbTrade: OptimalTrade | undefined, arbTradeOB: OptimalOrderbookTrade | undefined) {
		if (arbTrade && arbTradeOB) {
			if (arbTrade.profit > arbTradeOB.profit) {
				await this.tradeAmm(arbTrade);
				this.cdPaths(arbTrade.path);
			} else if (arbTrade.profit <= arbTradeOB.profit) {
				await this.tradeOrderbook(arbTradeOB);
				this.cdPaths(arbTradeOB.path);
			}
		} else if (arbTrade) {
			await this.tradeAmm(arbTrade);
			this.cdPaths(arbTrade.path);
		} else if (arbTradeOB) {
			await this.tradeOrderbook(arbTradeOB);
			this.cdPaths(arbTradeOB.path);
		}

		await delay(6000);
		// await this.logger?.sendMessage(JSON.stringify(msgs), LogType.Console);
	}
	/**
	 *
	 */
	private async tradeOrderbook(arbTradeOB: OptimalOrderbookTrade) {
		const messages = this.messageFactory(arbTradeOB, this.chainOperator.client.publicAddress, undefined);
		if (!messages) {
			console.error("error in creating messages", 1);
			process.exit(1);
		}
		if (arbTradeOB.path.orderSequence === OrderSequence.AmmFirst) {
			const txResponse = await this.chainOperator.signAndBroadcast(messages[0]);
			await this.logger?.tradeLogging.logOrderbookTrade(<OptimalOrderbookTrade>arbTradeOB, [txResponse]);
		} else {
			const txResponse = await this.chainOperator.signAndBroadcast([messages[0][0]]);
			await delay(2000);
			const txResponse2 = await this.chainOperator.signAndBroadcast([messages[0][1]]);
			await this.logger?.tradeLogging.logOrderbookTrade(<OptimalOrderbookTrade>arbTradeOB, [
				txResponse,
				txResponse2,
			]);
		}
	}

	/**
	 *
	 */
	private async tradeAmm(arbTrade: OptimalTrade) {
		const messages = this.messageFactory(
			arbTrade,
			this.chainOperator.client.publicAddress,
			this.chainConfig.flashloanRouterAddress,
		);
		if (!messages) {
			console.error("error in creating messages", 1);
			process.exit(1);
		}
		const txResponse = await this.chainOperator.signAndBroadcast(messages[0]);

		await this.logger?.tradeLogging.logAmmTrade(arbTrade, [txResponse]);
	}

	/**
	 * Put path on Cooldown, add to CDPaths with iteration number as block.
	 * Updates the iteration count of elements in CDpaths if its in equalpath of param: path
	 * Updates this.Path.
	 */
	public cdPaths(path: Path | OrderbookPath) {
		//add equalpaths to the CDPath array
		for (const equalpath of path.equalpaths) {
			this.CDpaths.set(equalpath[0], [this.iterations, 5, equalpath[1]]);
		}
		//add self to the CDPath array
		this.CDpaths.set(path.identifier[0], [this.iterations, 10, path.identifier[1]]);

		const out = new Array<Path>();
		//remove all equal paths from this.paths if this.paths'identifier overlaps with one in equalpaths
		this.paths.forEach((activePath) => {
			//if our updated cdpaths contains the path still active, make sure to remove it from the active paths
			if (!this.CDpaths.get(activePath.identifier[0])) {
				out.push(activePath);
			}
		});
		this.paths = out;

		const outOB = new Array<OrderbookPath>();
		//remove all equal paths from this.paths if this.paths'identifier overlaps with one in equalpaths
		this.orderbookPaths.forEach((activePath) => {
			//if our updated cdpaths contains the path still active, make sure to remove it from the active paths
			if (!this.CDpaths.get(activePath.identifier[0])) {
				outOB.push(activePath);
			}
		});
		this.orderbookPaths = outOB;
	}

	/** Removes the CD Paths if CD iteration number of path + Cooldownblocks <= this.iterations
	 * ADDS the path from pathlibary to this.paths.
	 */
	public unCDPaths() {
		this.CDpaths.forEach((value, key) => {
			// if time set to cooldown (in iteration numbers) + cooldown amount < current iteration, remove it from cd
			if (value[0] + value[1] < this.iterations) {
				this.CDpaths.delete(key);
				//add the path back to active paths
				this.paths.push(this.pathlib[value[2]]);
			}
		});
	}

	/**
	 *
	 */
	public clearIgnoreAddresses() {
		return;
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
