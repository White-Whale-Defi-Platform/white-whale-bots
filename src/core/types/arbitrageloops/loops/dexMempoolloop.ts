/* eslint-disable simple-import-sort/imports */

import { sha256 } from "@cosmjs/crypto";
import { toHex } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";
import { getPaths, newGraph } from "../../../arbitrage/graph";
import { inspect } from "util";
import { OptimalTrade, tryAmmArb, tryOrderbookArb } from "../../../arbitrage/arbitrage";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { DexConfig } from "../../base/configs";
import { LogType } from "../../base/logging";
import { Mempool, IgnoredAddresses, MempoolTx, decodeMempool, flushTxMemory } from "../../base/mempool";
import { getOrderbookAmmPaths, OrderbookPath, Path } from "../../base/path";
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
	botConfig: DexConfig;
	logger: Logger | undefined;
	iterations = 0;
	updatePoolStates: DexLoopInterface["updatePoolStates"];
	updateOrderbookStates?: (chainOperator: ChainOperator, orderbooks: Array<Orderbook>) => Promise<void>;
	messageFunction: DexLoopInterface["messageFunction"];
	ammArb: (paths: Array<Path>, botConfig: DexConfig) => OptimalTrade | undefined;
	orderbookArb: (paths: Array<OrderbookPath>, botConfig: DexConfig) => OptimalOrderbookTrade | undefined;
	// CACHE VALUES
	totalBytes = 0;
	mempool!: Mempool;
	ignoreAddresses!: IgnoredAddresses;

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
		messageFunction: (
			arbTrade: OptimalTrade,
			walletAddress: string,
			flashloancontract: string,
		) => [Array<EncodeObject>, number],
		updateOrderbookStates?: DexLoopInterface["updateOrderbookStates"],
	) {
		const graph = newGraph(allPools);
		const paths = getPaths(graph, botConfig.offerAssetInfo, botConfig.maxPathPools) ?? [];
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
		this.messageFunction = messageFunction;
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
		await this.updatePoolStates(this.chainOperator, this.pools);
		if (this.updateOrderbookStates) {
			await this.updateOrderbookStates(this.chainOperator, this.orderbooks);
		}

		const arbTrade: OptimalTrade | undefined = this.ammArb(this.paths, this.botConfig);

		if (arbTrade) {
			await this.trade(arbTrade);
			this.cdPaths(arbTrade.path);
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

			if (arbTrade) {
				await this.trade(arbTrade);
				console.log("mempool transactions to backrun:");
				mempoolTxs.map((mpt) => {
					console.log(toHex(sha256(mpt.txBytes)));
				});
				this.cdPaths(arbTrade.path);
				await this.chainOperator.reset();
				break;
			}
		}
		return;
	}

	/**
	 *
	 */
	async reset() {
		this.unCDPaths();
		this.totalBytes = 0;
		flushTxMemory();
	}

	/**
	 *
	 */
	public async trade(arbTrade: OptimalTrade) {
		const [msgs, nrOfMessages] = this.messageFunction(
			arbTrade,
			this.chainOperator.client.publicAddress,
			this.botConfig.flashloanRouterAddress,
		);

		// await this.logger?.sendMessage(JSON.stringify(msgs), LogType.Console);

		const TX_FEE =
			this.botConfig.txFees.get(nrOfMessages) ??
			Array.from(this.botConfig.txFees.values())[this.botConfig.txFees.size - 1];
		console.log(inspect(TX_FEE));
		const txResponse = await this.chainOperator.signAndBroadcast(msgs, TX_FEE);

		await this.logger?.sendMessage(JSON.stringify(txResponse), LogType.Console);

		if (txResponse.code === 0) {
			this.chainOperator.client.sequence = this.chainOperator.client.sequence + 1;
		}
		await delay(5000);
	}

	/**
	 * Put path on Cooldown, add to CDPaths with iteration number as block.
	 * Updates the iteration count of elements in CDpaths if its in equalpath of param: path
	 * Updates this.Path.
	 */
	public cdPaths(path: Path) {
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
