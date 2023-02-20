import { AccountData } from "@cosmjs/amino";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { EncodeObject } from "@cosmjs/proto-signing";
import { SignerData } from "@cosmjs/stargate";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { SkipBundleClient } from "@skip-mev/skipjs";
import { WebClient } from "@slack/web-api";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { OptimalTrade } from "../../arbitrage/arbitrage";
import { Logger } from "../../logging";
import { BotClients } from "../../node/chainoperator";
import { SkipResult } from "../../node/skipclients";
import { BotConfig } from "../base/botConfig";
import { LogType } from "../base/logging";
import { MempoolTrade, processMempool } from "../base/mempool";
import { Path } from "../base/path";
import { applyMempoolTradesOnPools, Pool } from "../base/pool";
import { MempoolLoop } from "./mempoolLoop";

/**
 *
 */
export class SkipLoop extends MempoolLoop {
	skipClient: SkipBundleClient;
	skipSigner: DirectSecp256k1HdWallet;
	slackLogger: WebClient | undefined;
	logger: Logger | undefined;

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
			flashloanRouterAddress: string,
		) => [Array<EncodeObject>, number],
		botClients: BotClients,
		account: AccountData,
		botConfig: BotConfig,
		skipClient: SkipBundleClient,
		skipSigner: DirectSecp256k1HdWallet,
		logger: Logger | undefined,
	) {
		super(pools, paths, arbitrage, updateState, messageFunction, botClients, account, botConfig, logger);
		(this.skipClient = skipClient), (this.skipSigner = skipSigner), (this.logger = logger);
	}

	/**
	 *
	 */
	public async step(): Promise<void> {
		this.iterations++;
		this.updateStateFunction(this.botClients, this.pools);
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
				for (const trade of mempoolTrades) {
					applyMempoolTradesOnPools(this.pools, [trade]);
					const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig);
					if (arbTrade) {
						await this.skipTrade(arbTrade, trade);
						arbTrade.path.cooldown = true; //set the cooldown of this path to true so we dont trade it again in next callbacks
					}
				}
			}
		}
	}

	/**
	 *
	 */
	private async skipTrade(arbTrade: OptimalTrade, toArbTrade: MempoolTrade) {
		if (arbTrade.path.cooldown) {
			// dont execute if path is on cooldown
			return;
		}
		if (
			!this.botConfig.skipConfig?.useSkip ||
			this.botConfig.skipConfig?.skipRpcUrl === undefined ||
			this.botConfig.skipConfig?.min_skip_bid_rate === undefined ||
			this.botConfig.skipConfig?.skipBidWallet === undefined
		) {
			await this.logger?.sendMessage(
				"Please setup skip variables in the config environment file",
				LogType.Console,
			);
			return;
		}

		let blockheight = Number(await (
			await this.botClients.HttpClient.execute(createJsonRpcRequest("block"))
		).result.block.height)

		const signerData: SignerData = {
			accountNumber: this.accountNumber,
			sequence: this.sequence,
			chainId: this.chainid,
		};
		let [msgs, nrOfWasms] = this.messageFunction(
			arbTrade,
			this.account.address,
			this.botConfig.flashloanRouterAddress,
		);

		//if gas fee cannot be found in the botconfig based on pathlengths, pick highest available
		const TX_FEE =
			this.botConfig.txFees.get(nrOfWasms) ??
			Array.from(this.botConfig.txFees.values())[this.botConfig.txFees.size - 1];

		// const txBytes = TxRaw.encode(txRaw).finish();
		// const normalResult = await this.botClients.TMClient.broadcastTxSync({ tx: txBytes });
		// console.log(normalResult);
		let res: SkipResult = {
			result: {
				code: 7,
				txs: [],
				auction_fee: "",
				bundle_size: "",
				desired_height: "",
				waited_for_simulation_results: true,
				simulation_success: true,
				result_check_txs: [],
				result_deliver_txs: [],
				error: "",
			},
			jsonrpc: "",
			id: 0,
		};
		let tmp_raw: TxRaw;
		const txToArbRaw: TxRaw = TxRaw.decode(toArbTrade.txBytes);
		let curr_bid = this.botConfig.skipConfig.min_skip_bid_rate - this.botConfig.skipConfig.bidding_steps;
		let signed;

		while (
			(!res.result.code || res.result.code == 7) &&
			curr_bid + this.botConfig.skipConfig.bidding_steps <= this.botConfig.skipConfig.max_skip_bid_rate
		) {
			curr_bid = this.botConfig.skipConfig.min_skip_bid_rate + this.botConfig.skipConfig.bidding_steps;
			tmp_raw = await this.createBidMsg(arbTrade, curr_bid, signerData, msgs, TX_FEE, this.botConfig.skipConfig.skipBidWallet);
			signed = await this.skipClient.signBundle([txToArbRaw, tmp_raw], this.skipSigner, this.account.address);
			res = <SkipResult>await this.skipClient.sendBundle(signed, blockheight, true);
		}

		let logItem = "";
		let logMessage = `**wallet:** ${this.account.address}\t **block:** ${res.result.desired_height}\t **profit:** ${arbTrade.profit}`;

		if (res.result.code !== 0) {
			logMessage += `\t **error code:** ${res.result.code}\n**error:** ${res.result.error}\n`;
		}

		if (res.result.result_check_txs != undefined) {
			res.result.result_check_txs.map(async (item, idx) => {
				if (item["code"] != "0") {
					logItem = JSON.stringify(item);

					const logMessageCheckTx = `**CheckTx Error:** index: ${idx}\t ${String(item.log)}\n`;
					logMessage = logMessage.concat(logMessageCheckTx);
				}
			});
		}
		if (res.result.result_deliver_txs != undefined) {
			res.result.result_deliver_txs.map(async (item, idx) => {
				if (item["code"] != "0") {
					logItem = JSON.stringify(item);

					const logMessageDeliverTx = `**DeliverTx Error:** index: ${idx}\t ${String(item.log)}\n`;
					logMessage = logMessage.concat(logMessageDeliverTx);
				}
			});
		}

		await this.logger?.sendMessage(logMessage, LogType.All, res.result.code);

		if (logItem.length > 0) {
			await this.logger?.sendMessage(logItem, LogType.Console);
		}

		if (res.result.code === 0) {
			this.sequence += 1;
		} else {
			await this.fetchRequiredChainData();
		}
		await delay(5000);
	}



	private async createBidMsg(
		arbtrade: OptimalTrade,
		bid: number,
		signer: SignerData,
		msgs: EncodeObject[],
		tx_fee: any,
		bid_wallet: string,
	): Promise<TxRaw> {
		let msg = msgs;
		let bidMsg: MsgSend = MsgSend.fromJSON({
			fromAddress: this.account.address,
			toAddress: bid_wallet,
			amount: [
				{
					denom: this.botConfig.offerAssetInfo.native_token.denom,
					amount: String(Math.max(Math.round(arbtrade.profit * bid), 651)),
				},
			],
		});

		let bidMsgEncodedObject: EncodeObject = {
			typeUrl: "/cosmos.bank.v1beta1.MsgSend",
			value: bidMsg,
		};

		msg.push(bidMsgEncodedObject);
		//if gas fee cannot be found in the botconfig based on pathlengths, pick highest available

		return await this.botClients.SigningCWClient.sign(this.account.address, msg, tx_fee, "", signer);
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
