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
import { sendSlackMessage } from "../../logging/slacklogger";
import { BotClients } from "../../node/chainoperator";
import { SkipResult } from "../../node/skipclients";
import { BotConfig } from "../core/botConfig";
import { MempoolTrade, processMempool } from "../core/mempool";
import { Path } from "../core/path";
import { applyMempoolTradesOnPools, Pool } from "../core/pool";
import { MempoolLoop } from "./mempoolLoop";

/**
 *
 */
export class SkipLoop extends MempoolLoop {
	skipClient: SkipBundleClient;
	skipSigner: DirectSecp256k1HdWallet;
	slackLogger: WebClient | undefined;
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
		slackLogger: WebClient | undefined,
	) {
		super(pools, paths, arbitrage, updateState, messageFunction, botClients, account, botConfig);
		(this.skipClient = skipClient), (this.skipSigner = skipSigner), (this.slackLogger = slackLogger);
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
						break;
					}
				}
			}
		}
	}
	/**
	 *
	 */
	private async skipTrade(arbTrade: OptimalTrade, toArbTrade: MempoolTrade) {
		if (
			!this.botConfig.useSkip ||
			this.botConfig.skipRpcUrl === undefined ||
			this.botConfig.skipBidRate === undefined ||
			this.botConfig.skipBidWallet === undefined
		) {
			console.error("please setup skip variables in the config environment file", 1);
			return;
		}
		const bidMsg: MsgSend = MsgSend.fromJSON({
			fromAddress: this.account.address,
			toAddress: this.botConfig.skipBidWallet,
			amount: [
				{
					denom: this.botConfig.offerAssetInfo.native_token.denom,
					amount: String(Math.max(Math.round(arbTrade.profit * this.botConfig.skipBidRate), 651)),
				},
			],
		});
		const bidMsgEncodedObject: EncodeObject = {
			typeUrl: "/cosmos.bank.v1beta1.MsgSend",
			value: bidMsg,
		};

		const signerData: SignerData = {
			accountNumber: this.accountNumber,
			sequence: this.sequence,
			chainId: this.chainid,
		};
		const [msgs, nrOfWasms] = this.messageFunction(
			arbTrade,
			this.account.address,
			this.botConfig.flashloanRouterAddress,
		);
		msgs.push(bidMsgEncodedObject);

		const GAS_FEE = nrOfWasms === 2 ? this.botConfig.txFee2Hop : this.botConfig.txFee3Hop;
		const txRaw: TxRaw = await this.botClients.SigningCWClient.sign(
			this.account.address,
			msgs,
			GAS_FEE,
			"",
			signerData,
		);
		// const txBytes = TxRaw.encode(txRaw).finish();
		// const normalResult = await this.botClients.TMClient.broadcastTxSync({ tx: txBytes });
		// console.log(normalResult);
		const txToArbRaw: TxRaw = TxRaw.decode(toArbTrade.txBytes);
		const signed = await this.skipClient.signBundle([txToArbRaw, txRaw], this.skipSigner, this.account.address);

		const res = <SkipResult>await this.skipClient.sendBundle(signed, 0, true);

		let slackMessage =
			"<*wallet:* " +
			this.account.address +
			"\n" +
			" *block:* " +
			res.result.desired_height +
			"\t" +
			"*profit:* " +
			arbTrade.profit +
			"\t" +
			"*errorcode* " +
			res.result.code +
			":\t" +
			res.result.error +
			"\n";

		console.log(res);
		if (res.result.result_check_txs != undefined) {
			res.result.result_check_txs.map(async (item, idx) => {
				if (item["code"] != "0") {
					console.log("CheckTx Error on index: ", idx);
					console.log(item);

					const slackMessageCheckTx = ">*CheckTx Error* on index: " + idx + ":\t" + String(item.log) + "\n";
					slackMessage = slackMessage.concat(slackMessageCheckTx);
				}
			});
		}
		if (res.result.result_deliver_txs != undefined) {
			res.result.result_deliver_txs.map(async (item, idx) => {
				if (item["code"] != "0") {
					console.log("deliver tx result of index: ", idx);
					console.log(item);
					const slackMessageDeliverTx =
						">*DeliverTx Error* on index: " + idx + "\t" + String(item.log) + "\n";
					slackMessage = slackMessage.concat(slackMessageDeliverTx);
				}
			});
		}
		console.log(slackMessage);
		await sendSlackMessage(slackMessage, this.slackLogger, this.botConfig.slackChannel);
		if (res.result.code === 0) {
			this.sequence += 1;
		} else {
			await this.fetchRequiredChainData();
		}
		await delay(5000);
	}
}
/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
