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
		arbitrage: (
			paths: Array<Path>,
			botConfig: BotConfig,
			errorpaths: Map<string, number>,
		) => OptimalTrade | undefined,
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
		timeouturls: Map<string, number>,
		errorpaths: Map<string, number>,
		logger: Logger | undefined,
	) {
		super(
			pools,
			paths,
			arbitrage,
			updateState,
			messageFunction,
			botClients,
			account,
			botConfig,
			timeouturls,
			errorpaths,
			logger,
		);
		(this.skipClient = skipClient), (this.skipSigner = skipSigner), (this.logger = logger);
	}

	/**
	 *
	 */
	public async step(): Promise<void> {
		this.iterations++;
		try {
			this.updateStateFunction(this.botClients, this.pools);
		} catch (e) {
			await this.errHandle(e);
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
				for (const trade of mempoolTrades) {
					try {
						applyMempoolTradesOnPools(this.pools, [trade]);
					} catch {
						console.log("error in apply mempooltradesonpools #51 on github");
						continue
					}
					const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(
						this.paths,
						this.botConfig,
						this.errorpaths,
					);
					if (arbTrade) {
						try {
							await this.skipTrade(arbTrade, trade);
						} catch (e) {
							await this.errHandle(e);
						}
						arbTrade.path.cooldown = true; //set the cooldown of this path to true so we dont trade it again in next callbacks
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
		if (arbTrade.path.cooldown) {
			// dont execute if path is on cooldown
			return;
		}
		if (
			!this.botConfig.skipConfig?.useSkip ||
			this.botConfig.skipConfig?.skipRpcUrl === undefined ||
			this.botConfig.skipConfig?.skipBidRate === undefined ||
			this.botConfig.skipConfig?.skipBidWallet === undefined
		) {
			await this.logger?.sendMessage(
				"Please setup skip variables in the config environment file",
				LogType.Console,
			);
			return;
		}
		const bidMsg: MsgSend = MsgSend.fromJSON({
			fromAddress: this.account.address,
			toAddress: this.botConfig.skipConfig.skipBidWallet,
			amount: [
				{
					denom: this.botConfig.offerAssetInfo.native_token.denom,
					amount: String(Math.max(Math.round(arbTrade.profit * this.botConfig.skipConfig.skipBidRate), 651)),
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

		//if gas fee cannot be found in the botconfig based on pathlengths, pick highest available
		const TX_FEE =
			this.botConfig.txFees.get(nrOfWasms) ??
			Array.from(this.botConfig.txFees.values())[this.botConfig.txFees.size - 1];

		const txRaw: TxRaw = await this.botClients.SigningCWClient.sign(
			this.account.address,
			msgs,
			TX_FEE,
			"",
			signerData,
		);
		// const txBytes = TxRaw.encode(txRaw).finish();
		// const normalResult = await this.botClients.TMClient.broadcastTxSync({ tx: txBytes });
		// console.log(normalResult);
		const txToArbRaw: TxRaw = TxRaw.decode(toArbTrade.txBytes);
		const signed = await this.skipClient.signBundle([txToArbRaw, txRaw], this.skipSigner, this.account.address);

		const res = <SkipResult>await this.skipClient.sendBundle(signed, 0, true);

		let logItem = "";
		let logMessage = `**wallet:** ${this.account.address}\t **block:** ${res.result.desired_height}\t **profit:** ${arbTrade.profit}`;

		if (res.result.code !== 0) {
			logMessage += `\t **error code:** ${res.result.code}\n**error:** ${res.result.error}\n`;
			if (res.result.code == 4) {
				await this.trade(arbTrade);
			}
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
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
