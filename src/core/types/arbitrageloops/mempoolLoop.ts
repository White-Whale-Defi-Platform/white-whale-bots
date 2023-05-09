import { sha256 } from "@cosmjs/crypto";
import { toHex } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";

import { OptimalTrade } from "../../arbitrage/arbitrage";
import { ChainOperator } from "../../chainOperator/chainoperator";
import { Logger } from "../../logging";
import { BotConfig } from "../base/botConfig";
import { LogType } from "../base/logging";
import { flushTxMemory, Mempool, MempoolTrade, processMempool } from "../base/mempool";
import { Path } from "../base/path";
import { applyMempoolTradesOnPools, Pool } from "../base/pool";
/**
 *
 */
export class MempoolLoop {
	pools: Array<Pool>;
	paths: Array<Path>; //holds all known paths minus cooldowned paths
	pathlib: Array<Path>; //holds all known paths
	CDpaths: Map<string, [number, number, number]>; //holds all cooldowned paths' identifiers
	chainOperator: ChainOperator;
	ignoreAddresses: { [index: string]: boolean };
	botConfig: BotConfig;
	logger: Logger | undefined;
	// CACHE VALUES
	totalBytes = 0;
	mempool!: Mempool;
	iterations = 0;

	/**
	 *
	 */
	arbitrageFunction: (paths: Array<Path>, botConfig: BotConfig) => OptimalTrade | undefined;
	updateStateFunction: (chainOperator: ChainOperator, pools: Array<Pool>) => void;
	messageFunction: (
		arbTrade: OptimalTrade,
		walletAddress: string,
		flashloancontract: string,
	) => [Array<EncodeObject>, number];

	/**
	 *
	 */
	public constructor(
		pools: Array<Pool>,
		paths: Array<Path>,
		arbitrage: (paths: Array<Path>, botConfig: BotConfig) => OptimalTrade | undefined,
		updateState: (chainOperator: ChainOperator, pools: Array<Pool>) => void,
		messageFunction: (
			arbTrade: OptimalTrade,
			walletAddress: string,
			flashloancontract: string,
		) => [Array<EncodeObject>, number],
		chainOperator: ChainOperator,
		botConfig: BotConfig,
		logger: Logger | undefined,
		pathlib: Array<Path>,
		ignoreAddresses: { [index: string]: boolean },
	) {
		this.pools = pools;
		this.CDpaths = new Map<string, [number, number, number]>();

		this.paths = paths;
		this.arbitrageFunction = arbitrage;
		this.updateStateFunction = updateState;
		this.messageFunction = messageFunction;
		this.chainOperator = chainOperator;
		this.botConfig = botConfig;
		this.logger = logger;
		this.pathlib = pathlib;
		this.ignoreAddresses = ignoreAddresses;
	}

	/**
	 *
	 */
	public async step() {
		this.iterations++;
		const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig);

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

			const mempooltxs: [Array<MempoolTrade>, Array<{ sender: string; reciever: string }>] = processMempool(
				this.mempool,
				this.ignoreAddresses,
			);
			// Checks if there is a SendMsg from a blacklisted Address, if so add the reciever to the timeouted addresses
			mempooltxs[1].forEach((Element) => {
				if (this.ignoreAddresses[Element.sender]) {
					this.ignoreAddresses[Element.reciever] = true;
				}
			});
			const mempoolTrades: Array<MempoolTrade> = mempooltxs[0];
			if (mempoolTrades.length === 0) {
				continue;
			} else {
				for (const trade of mempoolTrades) {
					if (trade.sender && !this.ignoreAddresses[trade.sender]) {
						applyMempoolTradesOnPools(this.pools, [trade]);
					}
				}
			}

			const arbTrade = this.arbitrageFunction(this.paths, this.botConfig);

			if (arbTrade) {
				await this.trade(arbTrade);
				console.log("mempool transactions to backrun:");
				mempoolTrades.map((mpt) => {
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
		this.updateStateFunction(this.chainOperator, this.pools);
		this.unCDPaths();
		this.totalBytes = 0;
		flushTxMemory();
	}

	/**
	 *
	 */
	private async trade(arbTrade: OptimalTrade) {
		const [msgs, nrOfMessages] = this.messageFunction(
			arbTrade,
			this.chainOperator.client.publicAddress,
			this.botConfig.flashloanRouterAddress,
		);

		// await this.logger?.sendMessage(JSON.stringify(msgs), LogType.Console);

		const TX_FEE =
			this.botConfig.txFees.get(nrOfMessages) ??
			Array.from(this.botConfig.txFees.values())[this.botConfig.txFees.size - 1];

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
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
