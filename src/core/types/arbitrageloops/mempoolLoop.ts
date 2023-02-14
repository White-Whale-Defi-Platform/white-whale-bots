import { AccountData } from "@cosmjs/amino";
import { EncodeObject } from "@cosmjs/proto-signing";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { OptimalTrade } from "../../arbitrage/arbitrage";
import { BotClients, getChainOperator } from "../../node/chainoperator";
import { BotConfig } from "../base/botConfig";
import { flushTxMemory, Mempool, MempoolTrade, processMempool } from "../base/mempool";
import { Path } from "../base/path";
import { applyMempoolTradesOnPools, Pool } from "../base/pool";

/**
 * Variables for the Timeout Duration of RPCs and Arbitrage Paths
 *
 */
const TIMEOUTDUR: number = 600000; // 10 Minutes
export const PATHTIMEOUT: number = 600000;



export class MempoolLoop {
	pools: Array<Pool>;
	paths: Array<Path>;
	botClients: BotClients;
	account: AccountData;
	accountNumber = 0;
	sequence = 0;
	chainid = "";
	botConfig: BotConfig;
	// CACHE VALUES
	totalBytes = 0;
	mempool!: Mempool;
	iterations = 0;
	timeouturls: Map<string, number>;
	errorpaths: Map<string, number>;

	/**
	 *
	 */
	arbitrageFunction: (paths: Array<Path>, botConfig: BotConfig, errorpaths: Map<string, number>) => OptimalTrade | undefined;
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
		arbitrage: (paths: Array<Path>, botConfig: BotConfig, errorpaths: Map<string, number>) => OptimalTrade | undefined,
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
	) {
		this.pools = pools;
		this.paths = paths;
		this.arbitrageFunction = arbitrage;
		this.updateStateFunction = updateState;
		this.messageFunction = messageFunction;
		this.botClients = botClients;
		this.account = account;
		this.botConfig = botConfig;
		this.timeouturls = timeouturls;
		this.errorpaths = errorpaths;
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
	 * Sets new Clients for Mempoolloop
	 * @param errurl: Old RPC-URL
	 */

	private async getNewClients(errurl: string) {
		let n: number = 0;
		let urlstring: string | undefined = undefined;
		this.timeouturls.set(errurl, Date.now())
		while (!urlstring && n < this.botConfig.rpcUrl.length) {
			let currtime: number = Date.now()

			if (!this.timeouturls.has(this.botConfig.rpcUrl[n])) {
				urlstring = this.botConfig.rpcUrl[n]
			}
			else {
				let errtime = this.timeouturls.get(this.botConfig.rpcUrl[n])
				if (errtime && errtime + TIMEOUTDUR <= currtime) {
					this.timeouturls.delete(this.botConfig.rpcUrl[n])
					urlstring = this.botConfig.rpcUrl[n]
				}
			}
			n++
		}
		if (!urlstring) {
			console.log("All RPC's Timeouted")
			let n: number = Date.now()
			let nexturl: string = errurl
			for (const [url, timeouted] of this.timeouturls.entries()) {
				if (timeouted < n) {
					n = timeouted
					nexturl = url
				}
			}
			delay(TIMEOUTDUR + n - Date.now())
			let [account, botClients] = await getChainOperator(this.botConfig, nexturl)
			this.account = account
			this.botClients = botClients
		}
		else {
			console.log("Updating Clients to: " + urlstring)
			let [account, botClients] = await getChainOperator(this.botConfig, urlstring)
			this.account = account
			this.botClients = botClients
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
			this.errhandle(e, "http")
		}

		const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig, this.errorpaths);

		if (arbTrade) {
			try {
				await this.trade(arbTrade);
			} catch (e) {
				this.errhandle(e, "tx")
			}
			return;
		}

		while (true) {
			try {
				const mempoolResult = await this.botClients.HttpClient.execute(createJsonRpcRequest("unconfirmed_txs"));
				this.mempool = mempoolResult.result;
			} catch (e) { this.errhandle(e, "http"); break; }

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
					this.errhandle(e, "tx")
				}
				break;
			}
		}

	}

	/*
	ERRORHANDLER 
	TODO: Define other Error Codes. Not sure if TIMEOUT works.
	*/

	private async errhandle(err: any, src: string) {
		console.error(err)
		// Catch errors, if status code is Timeout reconnect to next RPC and create/set new Clients. Else it does still quit the Bot.
		if (src == "http") {
			let errjsn = JSON.parse(err.message)
			if (errjsn["code"] == "TIMEOUT") {
				this.getNewClients(this.botClients.rpcurl)
			}
			else if (errjsn["message"].includes("Request failed with status code ")) {
				let errcode = errjsn["message"].match(/...$/)
				console.log(errcode)
			}
			else {
				console.log(errjsn)
				process.exit(1)
			}
		} else if (src == "tx") {
			let errjsn = JSON.parse(err.message)

			if (errjsn["code"] == -32603) {
				console.log("TX already in Cache");
			} else {
				console.log("Unknown Error: " + errjsn["code"])
				process.exit(1)
			}

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
	 * why not use broadcast_tx_commit if there is already a delay after sending the transaction
	 */
	private async trade(arbTrade: OptimalTrade) {
		let addrs: any = new Array
		//Get Addresses from arbTrade.path.Pools and add to array
		for (let i = 0; i < arbTrade.path.pools.length; i++) {
			addrs.push(arbTrade.path.pools[i].address);
		}
		//Needed as Key for errorpaths
		addrs = addrs.toString()

		// Check if Tradepath is on Cooldown because of error
		if (this.errorpaths.has(addrs) && this.errorpaths.get(addrs)! + PATHTIMEOUT > Date.now()) {
			return
		}
		const [msgs, nrOfMessages] = this.messageFunction(
			arbTrade,
			this.account.address,
			this.botConfig.flashloanRouterAddress,
		);
		console.log(msgs);
		const signerData = {
			accountNumber: this.accountNumber,
			sequence: this.sequence,
			chainId: this.chainid,
		};

		const TX_FEE =
			this.botConfig.txFees.get(arbTrade.path.pools.length) ??
			Array.from(this.botConfig.txFees.values())[this.botConfig.gasFees.size-1];

		// sign, encode and broadcast the transaction
		const txRaw = await this.botClients.SigningCWClient.sign(
			this.account.address,
			msgs,
			TX_FEE,
			"memo",
			signerData,
		);
		const txBytes = TxRaw.encode(txRaw).finish();

		//can use broadcastTxCommit?
		const sendResult = await this.botClients.TMClient.broadcastTxSync({ tx: txBytes });

		console.log(sendResult);
		this.sequence += 1;
		await delay(15000);
		//check tx result, if error put on cooldown. Catch if e.g TX not found after delay
		try {
			let txstatus = await this.botClients.TMClient.tx({ hash: sendResult.hash })
			if (txstatus.result.code != 0) {
				this.errorpaths.set(addrs, Date.now())
			}
		} catch {
			this.errorpaths.set(addrs, Date.now())
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

