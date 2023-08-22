import * as chains from "../../../../chains";
import { messageFactory } from "../../../../chains/defaults/messages/messageFactory";
import { OptimalTrade, tryAmmArb, tryOrderbookArb } from "../../../arbitrage/arbitrage";
import { getPaths, newGraph } from "../../../arbitrage/graph";
import { OptimalOrderbookTrade } from "../../../arbitrage/optimizers/orderbookOptimizer";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging";
import { DexConfig } from "../../base/configs";
import { LogType } from "../../base/logging";
import { Orderbook } from "../../base/orderbook";
import { getOrderbookAmmPaths, isOrderbookPath, OrderbookPath, OrderSequence, Path } from "../../base/path";
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
	botConfig: DexConfig;
	logger: Logger | undefined;
	iterations = 0;
	updatePoolStates: DexLoopInterface["updatePoolStates"];
	updateOrderbookStates?: DexLoopInterface["updateOrderbookStates"];
	messageFactory: DexLoopInterface["messageFactory"];
	ammArb: (paths: Array<Path>, botConfig: DexConfig) => OptimalTrade | undefined;
	orderbookArb: (paths: Array<OrderbookPath>, botConfig: DexConfig) => OptimalOrderbookTrade | undefined;

	/**
	 *
	 */
	public constructor(
		chainOperator: ChainOperator,
		botConfig: DexConfig,
		logger: Logger | undefined,
		allPools: Array<Pool>,
		orderbooks: Array<Orderbook>,
		updatePoolStates: DexLoopInterface["updatePoolStates"],
		messageFactory: DexLoopInterface["messageFactory"],
		updateOrderbookStates?: DexLoopInterface["updateOrderbookStates"],
	) {
		const graph = newGraph(allPools);
		const paths = getPaths(graph, botConfig.offerAssetInfo, botConfig.maxPathPools) ?? [];
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
		this.logger = logger;
	}
	/**
	 *
	 */
	static async createLoop(
		chainOperator: ChainOperator,
		botConfig: DexConfig,
		logger: Logger,
	): Promise<DexLoopInterface> {
		let msgFactory = chains.defaults.messageFactory;
		let getPoolStates = chains.defaults.getPoolStates;
		let initPools = chains.defaults.initPools;
		const initOrderbook = chains.injective.initOrderbooks;
		const getOrderbookState = chains.injective.getOrderbookState;
		await import("../../../../chains/" + botConfig.chainPrefix).then(async (chainSetups) => {
			if (chainSetups === undefined) {
				await logger.sendMessage("Unable to resolve specific chain imports, using defaults", LogType.Console);
			}
			msgFactory = chainSetups.getFlashArbMessages;
			getPoolStates = chainSetups.getPoolStates;
			initPools = chainSetups.initPools;
			return;
		});
		const orderbooks: Array<Orderbook> = [];
		if (botConfig.chainPrefix === "inj" && botConfig.orderbooks.length > 0) {
			const obs = await initOrderbook(chainOperator, botConfig);
			if (obs) {
				orderbooks.push(...obs);
			}
		}
		const allPools = await initPools(chainOperator, botConfig.poolEnvs, botConfig.mappingFactoryRouter);
		if (botConfig.useMempool && !botConfig.skipConfig?.useSkip) {
			return new DexMempoolLoop(
				chainOperator,
				botConfig,
				logger,
				allPools,
				orderbooks,
				getPoolStates,
				msgFactory,
				getOrderbookState,
			);
		} else if (botConfig.useMempool && botConfig.skipConfig?.useSkip) {
			return new DexMempoolSkipLoop(
				chainOperator,
				botConfig,
				logger,
				allPools,
				orderbooks,
				getPoolStates,
				msgFactory,
				getOrderbookState,
			);
		}
		return new DexLoop(
			chainOperator,
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

		const arbTrade: OptimalTrade | undefined = this.ammArb(this.paths, this.botConfig);
		const arbtradeOB = this.orderbookArb(this.orderbookPaths, this.botConfig);
		if (arbTrade || arbtradeOB) {
			if (arbTrade && arbtradeOB) {
				if (arbTrade.profit > arbtradeOB.profit) {
					await this.trade(arbTrade);
				} else if (arbtradeOB.profit >= arbTrade.profit) {
					await this.trade(arbtradeOB);
				}
				this.cdPaths(arbTrade.path);
				this.cdPaths(arbtradeOB.path);
			} else if (arbTrade) {
				await this.trade(arbTrade);
				this.cdPaths(arbTrade.path);
			} else if (arbtradeOB) {
				await this.trade(arbtradeOB);
				this.cdPaths(arbtradeOB.path);
			}

			await this.chainOperator.reset();
		}

		await delay(1500);
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
	public async trade(arbTrade: OptimalTrade | OptimalOrderbookTrade) {
		const publicAddress = this.chainOperator.client.publicAddress;
		const messages = this.messageFactory(arbTrade, publicAddress, this.botConfig.flashloanRouterAddress);
		if (!messages) {
			console.error("error in creating messages", 1);
			process.exit(1);
		}
		if (isOrderbookPath(arbTrade.path)) {
			if (arbTrade.path.orderSequence === OrderSequence.AmmFirst) {
				const txResponse = await this.chainOperator.signAndBroadcast(messages[0]);
				await this.logger?.tradeLogging.logOrderbookTrade(<OptimalOrderbookTrade>arbTrade, [txResponse]);
			} else {
				const txResponse = await this.chainOperator.signAndBroadcast([messages[0][0]]);
				await delay(2000);
				const txResponse2 = await this.chainOperator.signAndBroadcast([messages[0][1]]);
				await this.logger?.tradeLogging.logOrderbookTrade(<OptimalOrderbookTrade>arbTrade, [
					txResponse,
					txResponse2,
				]);
			}
		} else {
			const txResponse = await this.chainOperator.signAndBroadcast(messages[0]);
			await this.logger?.tradeLogging.logAmmTrade(<OptimalTrade>arbTrade, [txResponse]);
		}
		await delay(10000);
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
