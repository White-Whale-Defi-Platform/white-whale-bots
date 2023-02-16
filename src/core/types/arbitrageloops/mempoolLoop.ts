import { AccountData } from "@cosmjs/amino";
import { EncodeObject } from "@cosmjs/proto-signing";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { OptimalTrade } from "../../arbitrage/arbitrage";
import { Logger } from "../../logging";
import { BotClients, getChainOperator } from "../../node/chainoperator";
import { BotConfig } from "../base/botConfig";
import { LogType } from "../base/logging";
import { flushTxMemory, Mempool, MempoolTrade, processMempool } from "../base/mempool";
import { Path } from "../base/path";
import { applyMempoolTradesOnPools, Pool } from "../base/pool";

/**.
 * Variables for the Timeout Duration of RPCs and Arbitrage Paths
 *
 */
const TIMEOUTDUR = 600000; // 10 Minutes
export const PATHTIMEOUT = 600000;

/**
 *
 */
export class MempoolLoop {
	pools: Array<Pool>;
	paths: Array<Path>;
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
	timeoutUrls: Map<string, number>;
	errorpaths: Map<string, number>;

	/**
	 *
	 */
	arbitrageFunction: (
		paths: Array<Path>,
		botConfig: BotConfig,
		errorpaths: Map<string, number>,
	) => OptimalTrade | undefined;
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
		arbitrage: (
			paths: Array<Path>,
			botConfig: BotConfig,
			errorpaths: Map<string, number>,
		) => OptimalTrade | undefined,
		updateState: (botclients: BotClients, pools: Array<Pool>) => void,
		messageFunction: (
			arbTrade: OptimalTrade,
			walletAddress: string,
			flashloancontract: string,
		) => [Array<EncodeObject>, number],
		botClients: BotClients,
		account: AccountData,
		botConfig: BotConfig,
		timeouturls: Map<string, number>,
		errorpaths: Map<string, number>,
		logger: Logger | undefined,
	) {
		this.pools = pools;
		this.paths = paths;
		this.arbitrageFunction = arbitrage;
		this.updateStateFunction = updateState;
		this.messageFunction = messageFunction;
		this.botClients = botClients;
		this.account = account;
		this.botConfig = botConfig;
		this.timeoutUrls = timeouturls;
		this.errorpaths = errorpaths;
		this.logger = logger;
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
	 * Sets new Clients for Mempoolloop.
	 * @param errUrl: Old RPC-URL.
	 */
	private async getNewClients(errUrl: string) {
		let n = 0;
		let urlString: string | undefined;
		this.timeoutUrls.set(errUrl, Date.now());
		while (!urlString && n < this.botConfig.rpcUrl.length) {
			const currTime: number = Date.now();

			if (!this.timeoutUrls.has(this.botConfig.rpcUrl[n])) {
				urlString = this.botConfig.rpcUrl[n];
			} else {
				const errTime = this.timeoutUrls.get(this.botConfig.rpcUrl[n]);
				if (errTime && errTime + TIMEOUTDUR <= currTime) {
					this.timeoutUrls.delete(this.botConfig.rpcUrl[n]);
					urlString = this.botConfig.rpcUrl[n];
				}
			}
			n++;
		}
		if (!urlString) {
			console.log("All RPC's Timeouted");
			let n: number = Date.now();
			let nextUrl: string = errUrl;
			for (const [url, timeouted] of this.timeoutUrls.entries()) {
				if (timeouted < n) {
					n = timeouted;
					nextUrl = url;
				}
			}
			await delay(TIMEOUTDUR + n - Date.now());
			const [account, botClients] = await getChainOperator(this.botConfig, nextUrl);
			this.account = account;
			this.botClients = botClients;
		} else {
			console.log("Updating Clients to: " + urlString);
			const [account, botClients] = await getChainOperator(this.botConfig, urlString);
			this.account = account;
			this.botClients = botClients;
		}
	}
	/**
	 *
	 */
	public async step() {
		this.iterations++;
		try {
			this.updateStateFunction(this.botClients, this.pools);
		} catch (e) {
			await this.errHandle(e);
		}

		const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig, this.errorpaths);

		if (arbTrade) {
			try {
				await this.trade(arbTrade);
			} catch (e) {
				await this.errHandle(e);
			}
			return;
		}

		while (true) {
			try {
				const mempoolResult = await this.botClients.HttpClient.execute(createJsonRpcRequest("unconfirmed_txs"));
				this.mempool = mempoolResult.result;
			} catch (e) {
				await this.errHandle(e);
				break;
			}

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

			const arbTrade = this.arbitrageFunction(this.paths, this.botConfig, this.errorpaths);

			if (arbTrade) {
				try {
					await this.trade(arbTrade);
				} catch (e) {
					await this.errHandle(e);
				}
				break;
			}
		}
	}

	/*
	ERRORHANDLER 
	TODO: Define other Error Codes. Not sure if TIMEOUT works.
	*/

	/**
	 *
	 */
	private async errHandle(err: any) {
		if (err.code) {
			switch (err.code) {
				case -32603:
					console.error("error on broadcastTxCommit: tx already exists in cache. Path timeouted.");
					break;
				case -32000:
					console.error("Server Error");
					await this.getNewClients(this.botClients.rpcurl);
					break;
				case -41736:
					console.error("SSL handshake failure");
					await this.getNewClients(this.botClients.rpcurl);
					break;
				case "ECONNRESET":
				case "ENOTFOUND":
				case "ETIMEDOUT":
				case "ECONNREFUSED":
					await this.getNewClients(this.botClients.rpcurl);
					break;
				default:
					console.error(
						"Not handled Error, please send to Discord Channel: \n" +
							err.code +
							" " +
							err.errno +
							" " +
							err.name +
							" \n" +
							err.message,
					);
			}
		} else {
			console.error(
				"Not handled Error, please send to Discord Channel: \n" +
					err.errno +
					" " +
					err.name +
					" \n" +
					err.message,
			);
		}
	}

	/**
	 *
	 */
	public reset() {
		this.totalBytes = 0;
		flushTxMemory();
	}

	/**
	 * 
	 */
	public async trade(arbTrade: OptimalTrade) {
		let addrs: any = [];
		//Get Addresses from arbTrade.path.Pools and add to array
		for (let i = 0; i < arbTrade.path.pools.length; i++) {
			addrs.push(arbTrade.path.pools[i].address);
		}
		//Needed as Key for errorpaths
		addrs = addrs.toString();

		// Check if Tradepath is on Cooldown because of error
		if (this.errorpaths.has(addrs) && this.errorpaths.get(addrs)! + PATHTIMEOUT > Date.now()) {
			return;
		}
		const [msgs, nrOfMessages] = this.messageFunction(
			arbTrade,
			this.account.address,
			this.botConfig.flashloanRouterAddress,
		);

		//await this.logger?.sendMessage(JSON.stringify(msgs), LogType.Console);

		const signerData = {
			accountNumber: this.accountNumber,
			sequence: this.sequence,
			chainId: this.chainid,
		};

		const TX_FEE =
			this.botConfig.txFees.get(arbTrade.path.pools.length) ??
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

		this.sequence += 1;
		await delay(15000);
		//check tx result, if error --> put on cooldown. Catch if e.g TX not found after delay
		try {
			const txStatus = await this.botClients.TMClient.tx({ hash: sendResult.hash });
			if (sendResult && txStatus.result.code != 0) {
				this.errorpaths.set(addrs, Date.now());
			} else {
				await this.logger?.sendMessage("TX Success!\n", LogType.Console);
			}
		} catch {
			this.errorpaths.set(addrs, Date.now());
		}

		await this.fetchRequiredChainData();
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
