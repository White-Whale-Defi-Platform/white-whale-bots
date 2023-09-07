/* eslint-disable simple-import-sort/imports */

import { sha256 } from "@cosmjs/crypto";
import { toHex } from "@cosmjs/encoding";
import { getPaths, newGraph } from "../../../arbitrage/graph";
import { OptimalTrade, tryAmmArb, tryOrderbookArb } from "../../../arbitrage/arbitrage";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { BotConfig, ChainConfig } from "../../base/configs";
import { Mempool, IgnoredAddresses, MempoolTx, decodeMempool, flushTxMemory } from "../../base/mempool";
import { getOrderbookAmmPaths, OrderbookPath, OrderSequence, Path } from "../../base/path";
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
	updateOrderbookStates?: (chainOperator: ChainOperator, orderbooks: Array<Orderbook>) => Promise<void>;
	messageFactory: DexLoopInterface["messageFactory"];
	ammArb: (paths: Array<Path>, chainConfig: ChainConfig) => OptimalTrade | undefined;
	orderbookArb: (paths: Array<OrderbookPath>, chainConfig: ChainConfig) => OptimalOrderbookTrade | undefined;
	// CACHE VALUES
	totalBytes = 0;
	mempool!: Mempool;
	ignoreAddresses!: IgnoredAddresses;

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
		updateState: (chainOperator: ChainOperator, pools: Array<Pool>) => Promise<void>,
		messageFactory: DexLoopInterface["messageFactory"],
		updateOrderbookStates?: DexLoopInterface["updateOrderbookStates"],
	) {
		const graph = newGraph(allPools);
		const paths = getPaths(graph, chainConfig.offerAssetInfo, botConfig.maxPathPools) ?? [];
		const filteredPools = removedUnusedPools(allPools, paths);
		const orderbookPaths = getOrderbookAmmPaths(allPools, orderbooks);
		this.orderbookPaths = orderbookPaths;
		this.pools = filteredPools;
		this.orderbooks = orderbooks;
		this.CDpaths = new Map<string, [number, number, number]>();
		this.paths = paths;
		this.pathlib = paths;
		this.ammArb = tryAmmArb;
		this.orderbookArb = tryOrderbookArb;
		this.updateOrderbookStates = updateOrderbookStates;
		this.updatePoolStates = updateState;
		this.messageFactory = messageFactory;
		this.chainOperator = chainOperator;
		this.chainConfig = chainConfig;
		this.botConfig = botConfig;
		this.logger = logger;
		this.ignoreAddresses = chainConfig.ignoreAddresses ?? {};
	}
	/**
	 *
	 */
	public async step() {
		this.iterations++;
		await this.updatePoolStates(this.chainOperator, this.pools);
		if (this.updateOrderbookStates) {
			await this.updateOrderbookStates(this.chainOperator, this.orderbooks);
		}

		const arbTrade: OptimalTrade | undefined = this.ammArb(this.paths, this.chainConfig);
		const arbtradeOB = this.orderbookArb(this.orderbookPaths, this.chainConfig);

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
				this.chainConfig.timeoutDuration,
				this.iterations,
			);

			// Checks if there is a SendMsg from a blacklisted Address, if so add the reciever to the timeouted addresses
			if (mempoolTxs.length === 0) {
				continue;
			} else {
				applyMempoolMessagesOnPools(this.pools, mempoolTxs);
			}

			const arbTrade = this.ammArb(this.paths, this.chainConfig);
			const arbtradeOB = this.orderbookArb(this.orderbookPaths, this.chainConfig);

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
		const TX_FEE =
			this.chainConfig.txFees.get(messages[1]) ??
			Array.from(this.chainConfig.txFees.values())[this.chainConfig.txFees.size - 1];

		if (arbTradeOB.path.orderSequence === OrderSequence.AmmFirst) {
			const txResponse = await this.chainOperator.signAndBroadcast(messages[0], TX_FEE);
			await this.logger?.tradeLogging.logOrderbookTrade(<OptimalOrderbookTrade>arbTradeOB, [txResponse]);
		} else {
			const txResponse = await this.chainOperator.signAndBroadcast([messages[0][0]], TX_FEE);
			await delay(3000);
			const txResponse2 = await this.chainOperator.signAndBroadcast([messages[0][1]], TX_FEE);
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
		const TX_FEE =
			this.chainConfig.txFees.get(messages[1]) ??
			Array.from(this.chainConfig.txFees.values())[this.chainConfig.txFees.size - 1];

		const txResponse = await this.chainOperator.signAndBroadcast(messages[0], TX_FEE);

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
			this.CDpaths.set(equalpath[0], [this.iterations, 30, equalpath[1]]);
		}
		//add self to the CDPath array
		this.CDpaths.set(path.identifier[0], [this.iterations, 60, path.identifier[1]]);

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

	/**.
	 *
	 * Removes the CD Paths if CD iteration number of path + Cooldownblocks <= this.iterations
	 * ADDS the path from pathlibary to this.paths.
	 */
	/**
	 *
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
