import { AccountData } from "@cosmjs/amino";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { EncodeObject } from "@cosmjs/proto-signing";
import { SignerData } from "@cosmjs/stargate";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { SkipBundleClient } from "@skip-mev/skipjs";
import { WebClient } from "@slack/web-api";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { sendSlackMessage } from "../../logging/slacklogger";
import { BotClients } from "../../node/chainoperator";
import { SkipResult } from "../../node/skipclients";
import { Asset, AssetInfo, isNativeAsset } from "../core/asset";
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
	skipBidRate: number;
	skipBidWallet: string;
	/**
	 *
	 */
	public constructor(
		pools: Array<Pool>,
		paths: Array<Path>,
		arbitrage: (
			paths: Array<Path>,
			offerAssetInfo: AssetInfo,
			[minProfit2Hop, minProfit3Hop]: [number, number],
		) => { path: Path; offerAsset: Asset; profit: number } | undefined,
		updateState: (botclients: BotClients, pools: Array<Pool>) => void,
		messageFunction: (path: Path, walletAddress: string, offerAsset0: Asset) => [Array<EncodeObject>, number],
		botClients: BotClients,
		account: AccountData,
		offerAssetInfo: AssetInfo,
		[minProfit2Hop, minProfit3Hop]: [number, number],
		skipClient: SkipBundleClient,
		skipSigner: DirectSecp256k1HdWallet,
		slackLogger: WebClient | undefined,
		skipBidRate: number,
		skipBidWallet: string,
	) {
		super(pools, paths, arbitrage, updateState, messageFunction, botClients, account, offerAssetInfo, [
			minProfit2Hop,
			minProfit3Hop,
		]);
		(this.skipClient = skipClient), (this.skipSigner = skipSigner), (this.slackLogger = slackLogger);
		(this.skipBidRate = skipBidRate), (this.skipBidWallet = skipBidWallet);
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
					const arbTrade: { path: Path; offerAsset: Asset; profit: number } | undefined =
						this.arbitrageFunction(this.paths, this.offerAssetInfo, this.minProfits);
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
	private async skipTrade(arbTrade: { path: Path; offerAsset: Asset; profit: number }, toArbTrade: MempoolTrade) {
		const bidMsg: MsgSend = MsgSend.fromJSON({
			fromAddress: this.account.address,
			toAddress: this.skipBidWallet,
			amount: [
				{
					denom: isNativeAsset(this.offerAssetInfo)
						? this.offerAssetInfo.native_token.denom
						: this.offerAssetInfo.token.contract_addr,
					amount: String(Math.max(Math.round(arbTrade.profit * 0.1), 651)),
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
		const [msgs, nrOfWasms] = this.messageFunction(arbTrade.path, this.account.address, arbTrade.offerAsset);
		msgs.push(bidMsgEncodedObject);

		const txRaw: TxRaw = await this.botClients.SigningCWClient.sign(
			this.account.address,
			msgs,
			nrOfWasms == 2 ? this.tx_fees[0] : this.tx_fees[1],
			"",
			signerData,
		);
		const txToArbRaw: TxRaw = TxRaw.decode(toArbTrade.txBytes);
		const signed = await this.skipClient.signBundle([txToArbRaw, txRaw], this.skipSigner, this.account.address);

		const res = <SkipResult>await this.skipClient.sendBundle(signed, 0, true);

		let slackMessage =
			">*block:* " +
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
		await sendSlackMessage(slackMessage, this.slackLogger, "logging");
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
