/* eslint-disable simple-import-sort/imports */

import { sha256 } from "@cosmjs/crypto";
import { toHex } from "@cosmjs/encoding";
import { OptimalTrade, tryAmmArb, tryOrderbookArb } from "../../../arbitrage/arbitrage";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { DexConfig } from "../../base/configs";
import { Mempool, IgnoredAddresses, MempoolTx, decodeMempool, flushTxMemory } from "../../base/mempool";
import {
	getAmmPaths,
	getOrderbookAmmPaths,
	isOrderbookPath,
	OrderbookPath,
	OrderSequence,
	Path,
} from "../../base/path";
import { removedUnusedPools, applyMempoolMessagesOnPools, Pool } from "../../base/pool";
import { DexLoopInterface } from "../interfaces/dexloopInterface";
import { Orderbook } from "../../base/orderbook";
import { OptimalOrderbookTrade } from "../../../arbitrage/optimizers/orderbookOptimizer";

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
	ammArb: (paths: Array<Path>, botConfig: DexConfig) => OptimalTrade | undefined;
	orderbookArb: (paths: Array<OrderbookPath>, botConfig: DexConfig) => OptimalOrderbookTrade | undefined;
	// CACHE VALUES
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

		const arbtradeOB = this.orderbookArb(this.orderbookPaths, this.botConfig);

		if (arbTrade || arbtradeOB) {
			await this.trade(arbTrade, arbtradeOB);
			return;
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
			const arbtradeOB = this.orderbookArb(this.orderbookPaths, this.botConfig);

			if (arbTrade || arbtradeOB) {
				await this.trade(arbTrade, arbtradeOB);
				console.log("mempool transactions to backrun:");
				mempoolTxs.map((mpt) => {
					console.log(toHex(sha256(mpt.txBytes)));
				});
				break;
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
			const txResponse = await this.chainOperator.signAndBroadcast(messages[0], arbTradeOB.path.fee);
			await this.logger?.tradeLogging.logOrderbookTrade(<OptimalOrderbookTrade>arbTradeOB, [txResponse]);
		} else {
			const txResponse = await this.chainOperator.signAndBroadcast([messages[0][0]], arbTradeOB.path.fee);
			await delay(3000);
			const txResponse2 = await this.chainOperator.signAndBroadcast([messages[0][1]], arbTradeOB.path.fee);
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
			this.botConfig.flashloanRouterAddress,
		);
		if (!messages) {
			console.error("error in creating messages", 1);
			process.exit(1);
		}
		const txResponse = await this.chainOperator.signAndBroadcast(messages[0], arbTrade.path.fee);

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
