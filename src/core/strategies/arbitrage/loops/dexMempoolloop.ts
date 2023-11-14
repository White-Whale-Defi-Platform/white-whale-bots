/* eslint-disable simple-import-sort/imports */

import { tryAmmArb, tryOrderbookArb } from "../operations/arbitrage";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { DexConfig } from "../../../types/base/configs";
import { Mempool, IgnoredAddresses, MempoolTx, decodeMempool, flushTxMemory } from "../../../types/base/mempool";
import { getAmmPaths, getOrderbookAmmPaths, isOrderbookPath, OrderbookPath, Path } from "../../../types/base/path";
import { removedUnusedPools, applyMempoolMessagesOnPools, Pool } from "../../../types/base/pool";
import { DexLoopInterface } from "./loopinterfaces/dexloopInterface";
import { Orderbook } from "../../../types/base/orderbook";

import { OptimalOrderbookTrade, OptimalTrade, Trade, TradeType } from "../../../types/base/trades";

/**
 *
 */
export class DexMempoolLoop implements DexLoopInterface {
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
	updateOrderbookStates?: (chainOperator: ChainOperator, orderbooks: Array<Orderbook>) => Promise<void>;
	messageFactory: DexLoopInterface["messageFactory"];
	ammArb: DexLoopInterface["ammArb"];
	orderbookArb: DexLoopInterface["orderbookArb"]; // CACHE VALUES
	totalBytes = 0;
	mempool!: Mempool;
	ignoreAddresses!: IgnoredAddresses;
	blockHeight = 0;

	/**
	 *
	 */
	public constructor(
		chainOperator: ChainOperator,
		botConfig: DexConfig,
		logger: Logger | undefined,
		allPools: Array<Pool>,
		orderbooks: Array<Orderbook>,
		updateState: (chainOperator: ChainOperator, pools: Array<Pool>) => Promise<void>,
		messageFactory: DexLoopInterface["messageFactory"],
		updateOrderbookStates?: DexLoopInterface["updateOrderbookStates"],
	) {
		const paths = getAmmPaths(allPools, botConfig);
		const filteredPools = removedUnusedPools(allPools, paths);
		const orderbookPaths = getOrderbookAmmPaths(allPools, orderbooks, botConfig);
		this.orderbookPaths = orderbookPaths;
		this.pools = filteredPools;
		this.orderbooks = orderbooks;
		this.CDpaths = new Map<
			string,
			{ timeoutIteration: number; timeoutDuration: number; path: OrderbookPath | Path }
		>();
		this.paths = paths;
		this.ammArb = tryAmmArb;
		this.orderbookArb = tryOrderbookArb;
		this.updateOrderbookStates = updateOrderbookStates;
		this.updatePoolStates = updateState;
		this.messageFactory = messageFactory;
		this.chainOperator = chainOperator;
		this.botConfig = botConfig;
		this.logger = logger;
		this.ignoreAddresses = botConfig.ignoreAddresses ?? {};
	}
	/**
	 *
	 */
	public async step() {
		this.iterations++;

		if (this.updateOrderbookStates) {
			await Promise.all([
				this.updatePoolStates(this.chainOperator, this.pools),
				this.updateOrderbookStates(this.chainOperator, this.orderbooks),
			]);
		} else {
			await this.updatePoolStates(this.chainOperator, this.pools);
		}

		const arbTrade: OptimalTrade | undefined = this.ammArb(this.paths, this.botConfig);

		const arbTradeOB = this.orderbookArb(this.orderbookPaths, this.botConfig);

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

		while (true) {
			this.mempool = await this.chainOperator.queryMempool();

			if (+this.mempool.total_bytes < this.totalBytes) {
				break;
			} else if (+this.mempool.total_bytes === this.totalBytes) {
				continue;
			} else {
				this.totalBytes = +this.mempool.total_bytes;
			}

			const mempoolTxs: Array<MempoolTx> = decodeMempool(
				this.mempool,
				this.ignoreAddresses,
				this.botConfig.timeoutDuration,
				this.iterations,
			);

			// Checks if there is a SendMsg from a blacklisted Address, if so add the reciever to the timeouted addresses
			if (mempoolTxs.length === 0) {
				continue;
			} else {
				applyMempoolMessagesOnPools(this.pools, mempoolTxs);
			}

			const arbTrade = this.ammArb(this.paths, this.botConfig);
			const arbTradeOB = this.orderbookArb(this.orderbookPaths, this.botConfig);

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
		return;
	}

	/**
	 *
	 */
	async reset() {
		await this.chainOperator.reset();
		this.unCDPaths();
		this.totalBytes = 0;
		flushTxMemory();
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
		const txResponse = await this.chainOperator.signAndBroadcast([messages[0][0]], arbTradeOB.path.fee);
		await this.logger?.tradeLogging.logOrderbookTrade(arbTradeOB, txResponse);
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
				timeoutDuration: 5,
				path: equalpath,
			});
		}
		//add self to the CDPath array
		this.CDpaths.set(path.identifier, { timeoutIteration: this.iterations, timeoutDuration: 10, path: path });

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
		const keys = Object.keys(this.ignoreAddresses);
		for (let i = 0; i < keys.length; i++) {
			if (
				this.ignoreAddresses[keys[i]].timeoutAt > 0 &&
				this.ignoreAddresses[keys[i]].timeoutAt + this.ignoreAddresses[keys[i]].duration <= this.iterations
			) {
				delete this.ignoreAddresses[keys[i]];
			}
		}
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
