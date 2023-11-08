import * as chains from "../../../../chains";
import { messageFactory } from "../../../../chains/defaults/messages/messageFactory";
import { tryAmmArb, tryOrderbookArb } from "../../../arbitrage/arbitrage";
import {} from "../../../arbitrage/optimizers/orderbookOptimizer";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging";
import { DexConfig } from "../../base/configs";
import { LogType } from "../../base/logging";
import { Orderbook } from "../../base/orderbook";
import { getAmmPaths, getOrderbookAmmPaths, isOrderbookPath, OrderbookPath, Path } from "../../base/path";
import { Pool, removedUnusedPools } from "../../base/pool";
import { OptimalOrderbookTrade, OptimalTrade, Trade, TradeType } from "../../base/trades";
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
	CDpaths: Map<string, { timeoutIteration: number; timeoutDuration: number; path: OrderbookPath | Path }>; //holds all cooldowned paths' identifiers
	chainOperator: ChainOperator;
	accountNumber = 0;
	sequence = 0;
	botConfig: DexConfig;
	logger: Logger | undefined;
	iterations = 0;
	updatePoolStates: DexLoopInterface["updatePoolStates"];
	updateOrderbookStates?: DexLoopInterface["updateOrderbookStates"];
	messageFactory: DexLoopInterface["messageFactory"];
	ammArb: DexLoopInterface["ammArb"];
	orderbookArb: DexLoopInterface["orderbookArb"];

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
		const paths = getAmmPaths(allPools, botConfig);
		const filteredPools = removedUnusedPools(allPools, paths);
		const orderbookPaths = getOrderbookAmmPaths(allPools, orderbooks, botConfig);

		this.orderbookPaths = orderbookPaths;
		this.orderbooks = orderbooks;
		this.pools = filteredPools;
		this.CDpaths = new Map<
			string,
			{ timeoutIteration: number; timeoutDuration: number; path: OrderbookPath | Path }
		>();
		this.paths = paths;
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
			msgFactory = chainSetups.messageFactory;
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
			console.log("spinning up mempool loop");
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
			console.log("spinning up skip mempool loop");
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
		console.log("spinning up no-mempool loop");
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
		const arbTradeOB: OptimalOrderbookTrade | undefined = this.orderbookArb(this.orderbookPaths, this.botConfig);

		if (arbTrade && arbTradeOB) {
			if (arbTrade.profit > arbTradeOB.profit) {
				await this.trade(arbTrade);
			} else if (arbTrade.profit <= arbTradeOB.profit) {
				await this.trade(arbTradeOB);
			}
		} else if (arbTrade) {
			await this.trade(arbTrade);
		} else if (arbTradeOB) {
			await this.trade(arbTradeOB);
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
	public async trade(trade: Trade) {
		if (trade.tradeType === TradeType.AMM) {
			await this.tradeAmm(<OptimalTrade>trade);
		} else if (trade.tradeType === TradeType.COMBINED) {
			await this.tradeOrderbook(<OptimalOrderbookTrade>trade);
		}
		this.cdPaths(trade.path);

		await delay(6000);
	}
	// await this.logger?.sendMessage(JSON.stringify(msgs), LogType.Console);

	/**
	 *
	 */
	private async tradeOrderbook(arbTradeOB: OptimalOrderbookTrade) {
		const messages = this.messageFactory(
			arbTradeOB,
			this.chainOperator.client.publicAddress,
			this.botConfig.flashloanRouterAddress,
		);
		if (!messages) {
			console.error("error in creating messages", 1);
			process.exit(1);
		}

		const txResponse = await this.chainOperator.signAndBroadcast(messages[0], arbTradeOB.path.fee);
		await this.logger?.tradeLogging.logOrderbookTrade(<OptimalOrderbookTrade>arbTradeOB, txResponse);
	}

	/**
	 *
	 */
	private async tradeAmm(arbTrade: OptimalTrade) {
		const messages = this.messageFactory(
			arbTrade,
			this.chainOperator.client.publicAddress,
			this.botConfig.flashloanRouterAddress,
		);
		if (!messages) {
			console.error("error in creating messages", 1);
			process.exit(1);
		}
		const txResponse = await this.chainOperator.signAndBroadcast(messages[0], arbTrade.path.fee);

		await this.logger?.tradeLogging.logAmmTrade(arbTrade, txResponse);
	}

	/**
	 * Put path on Cooldown, add to CDPaths with iteration number as block.
	 * Updates the iteration count of elements in CDpaths if its in equalpath of param: path
	 * Updates this.Path.
	 */
	public cdPaths(path: Path | OrderbookPath) {
		//add equalpaths to the CDPath array
		for (const equalpath of path.equalpaths) {
			this.CDpaths.set(equalpath.identifier, {
				timeoutIteration: this.iterations,
				timeoutDuration: 30,
				path: equalpath,
			});
		}
		//add self to the CDPath array
		this.CDpaths.set(path.identifier, { timeoutIteration: this.iterations, timeoutDuration: 60, path: path });

		//remove all paths on cooldown from active paths
		this.paths = this.paths.filter((pathToCheck) => this.CDpaths.get(pathToCheck.identifier) === undefined);

		//remove all orderbookpaths on cooldown from active orderbookpaths
		this.orderbookPaths = this.orderbookPaths.filter(
			(pathToCheck) => this.CDpaths.get(pathToCheck.identifier) === undefined,
		);
	}

	/** Removes the CD Paths if CD iteration number of path + Cooldownblocks <= this.iterations.
	 */
	public unCDPaths() {
		this.CDpaths.forEach((value, key) => {
			// if time set to cooldown (in iteration numbers) + cooldown amount < current iteration, remove it from cd
			if (value.timeoutIteration + value.timeoutDuration < this.iterations) {
				this.CDpaths.delete(key);
				//add the path back to active paths
				if (isOrderbookPath(value.path)) {
					this.orderbookPaths.push(value.path);
				} else {
					this.paths.push(value.path);
				}
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
