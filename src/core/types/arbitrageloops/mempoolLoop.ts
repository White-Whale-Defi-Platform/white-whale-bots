import { AccountData } from "@cosmjs/amino";
import { EncodeObject } from "@cosmjs/proto-signing";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { OptimalTrade } from "../../arbitrage/arbitrage";
import { Logger } from "../../logging";
import { BotClients } from "../../node/chainoperator";
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
	botClients: BotClients;
	account: AccountData;
	accountNumber = 0;
	sequence = 0;
	chainid = "";
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
	updateStateFunction: (botClients: BotClients, pools: Array<Pool>) => void;
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
		updateState: (botclients: BotClients, pools: Array<Pool>) => void,
		messageFunction: (
			arbTrade: OptimalTrade,
			walletAddress: string,
			flashloancontract: string,
		) => [Array<EncodeObject>, number],
		botClients: BotClients,
		account: AccountData,
		botConfig: BotConfig,
		logger: Logger | undefined,
		pathlib: Array<Path>,
	) {
		this.pools = pools;
		this.CDpaths = new Map<string, [number, number, number]>();
		this.paths = paths;
		this.arbitrageFunction = arbitrage;
		this.updateStateFunction = updateState;
		this.messageFunction = messageFunction;
		this.botClients = botClients;
		this.account = account;
		this.botConfig = botConfig;
		this.logger = logger;
		this.pathlib = pathlib;
	}

	/**
	 *
	 */
	public async fetchRequiredChainData() {
		const { accountNumber, sequence } = await this.botClients.SigningCWClient.getSequence(this.account.address);
		this.sequence = sequence;
		this.accountNumber = accountNumber;

		const chainId = await this.botClients.SigningCWClient.getChainId();
		this.chainid = chainId;
	}

	/**
	 *
	 */
	public async step() {
		this.iterations++;
		this.updateStateFunction(this.botClients, this.pools);

		const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig);

		if (arbTrade) {
			await this.trade(arbTrade);
			//arbTrade.path.cooldown = true;
			this.cdPaths(arbTrade.path);
			return;
		}

		while (true) {
			const mempoolResult = await this.botClients.HttpClient.execute(createJsonRpcRequest("unconfirmed_txs"));
			this.mempool = mempoolResult.result;

			if (+this.mempool.total_bytes < this.totalBytes) {
				break;
			} else if (+this.mempool.total_bytes === this.totalBytes) {
				continue;
			} else {
				this.totalBytes = +this.mempool.total_bytes;
			}

			const mempoolTrades: Array<MempoolTrade> = processMempool(this.mempool);
			if (mempoolTrades.length === 0) {
				continue;
			} else {
				applyMempoolTradesOnPools(this.pools, mempoolTrades);
			}

			const arbTrade = this.arbitrageFunction(this.paths, this.botConfig);

			if (arbTrade) {
				await this.trade(arbTrade);
				//arbTrade.path.cooldown = true;
				this.cdPaths(arbTrade.path);
				break;
			}
		}
	}

	/**
	 *
	 */
	public reset() {
		console.log("resetting: ", this.iterations);
		console.log("cdpaths: ", this.CDpaths.size);
		console.log("active paths: ", this.paths.length);
		this.unCDPaths();
		console.log("cdpaths after reset: ", this.CDpaths.size);
		console.log("active paths after reset: ", this.paths.length);
		this.totalBytes = 0;
		flushTxMemory();
	}

	/**
	 *
	 */
	private async trade(arbTrade: OptimalTrade) {
		const [msgs, nrOfMessages] = this.messageFunction(
			arbTrade,
			this.account.address,
			this.botConfig.flashloanRouterAddress,
		);

		await this.logger?.sendMessage(JSON.stringify(msgs), LogType.Console);

		const signerData = {
			accountNumber: this.accountNumber,
			sequence: this.sequence,
			chainId: this.chainid,
		};

		const TX_FEE =
			this.botConfig.txFees.get(nrOfMessages) ??
			Array.from(this.botConfig.txFees.values())[this.botConfig.txFees.size - 1];

		// sign, encode and broadcast the transaction
		const txRaw = await this.botClients.SigningCWClient.sign(
			this.account.address,
			msgs,
			TX_FEE,
			"memo",
			signerData,
		);
		const txBytes = TxRaw.encode(txRaw).finish();
		const sendResult = await this.botClients.TMClient.broadcastTxSync({ tx: txBytes });

		await this.logger?.sendMessage(JSON.stringify(sendResult), LogType.Console);

		this.sequence += 1;
		await delay(5000);
		await this.fetchRequiredChainData();
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

		//remove all equal paths from this.paths if this.paths'identifier overlaps with one in equalpaths
		this.paths.forEach((activePath, index) => {
			//if our updated cdpaths contains the path still active, make sure to remove it from the active paths
			if (this.CDpaths.get(activePath.identifier[0])) {
				this.paths.splice(index, 1);
			}
		});
	}

	/**
	 *
	 * Removes the CD Paths if CD iteration number of path + Cooldownblocks <= this.iterations
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
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
