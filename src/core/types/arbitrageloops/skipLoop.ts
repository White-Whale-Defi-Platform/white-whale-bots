import { sha256 } from "@cosmjs/crypto";
import { toHex } from "@cosmjs/encoding";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { EncodeObject } from "@cosmjs/proto-signing";
import { SkipBundleClient } from "@skip-mev/skipjs";
import { WebClient } from "@slack/web-api";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { inspect } from "util";

import { getSendMessage } from "../../../chains/defaults/messages/getSendMessage";
import { OptimalTrade } from "../../arbitrage/arbitrage";
import { ChainOperator } from "../../chainOperator/chainoperator";
import { SkipResult } from "../../chainOperator/skipclients";
import { Logger } from "../../logging";
import { BotConfig } from "../base/botConfig";
import { LogType } from "../base/logging";
import { decodeMempool, MempoolTx } from "../base/mempool";
import { Path } from "../base/path";
import { applyMempoolMessagesOnPools, Pool } from "../base/pool";
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
		updateState: (chainOperator: ChainOperator, pools: Array<Pool>) => void,
		messageFunction: (
			arbTrade: OptimalTrade,
			walletAddress: string,
			flashloanRouterAddress: string,
		) => [Array<EncodeObject>, number],
		chainOperator: ChainOperator,
		botConfig: BotConfig,
		skipClient: SkipBundleClient,
		skipSigner: DirectSecp256k1HdWallet,
		logger: Logger | undefined,

		pathlib: Array<Path>,
		ignoreAddresses: { [index: string]: { source: boolean; timeout_at: number; duration: number } },
	) {
		super(
			pools,
			paths,
			arbitrage,
			updateState,
			messageFunction,
			chainOperator,
			botConfig,
			logger,
			pathlib,
			ignoreAddresses,
		);
		(this.skipClient = skipClient), (this.skipSigner = skipSigner), (this.logger = logger);
	}

	/**
	 *
	 */
	public async step(): Promise<void> {
		this.iterations++;
		const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig);

		if (arbTrade) {
			await this.skipTrade(arbTrade);
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

			const mempoolTxs: [Array<MempoolTx>, Array<{ sender: string; reciever: string }>] = processMempool(
				this.mempool,
				this.ignoreAddresses,
			);
			const mempoolTrades = mempoolTxs[0];
			mempoolTxs[1].forEach((Element) => {
				if (this.ignoreAddresses[Element.sender]) {
					if (
						this.ignoreAddresses[Element.sender].source ||
						this.ignoreAddresses[Element.sender].timeout_at +
							this.ignoreAddresses[Element.sender].duration <=
							this.iterations
					) {
						this.ignoreAddresses[Element.reciever] = {
							source: false,
							timeout_at: this.iterations,
							duration: this.botConfig.skipConfig!.timout_dur,
						};
						this.ignoreAddresses[Element.sender].timeout_at = this.iterations;
					} else if (
						this.ignoreAddresses[Element.sender].timeout_at +
							this.ignoreAddresses[Element.sender].duration >=
						this.iterations
					) {
						delete this.ignoreAddresses[Element.sender];
					}
				}
			});

			if (mempoolTxs[0].length === 0) {
				continue;
			} else {
				for (const mempoolTx of mempoolTxs) {
					applyMempoolMessagesOnPools(this.pools, [mempoolTx]);
					const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig);
					if (arbTrade) {
						await this.skipTrade(arbTrade, mempoolTx);
						this.cdPaths(arbTrade.path);
						await this.chainOperator.reset();
						return;
					}
				}
			}
		}
	}
	/**
	 *
	 */
	private async skipTrade(arbTrade: OptimalTrade, toArbTrade?: MempoolTx) {
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

		const skiprate = Math.max(Math.round(arbTrade.profit * this.botConfig.skipConfig.skipBidRate), 651);
		const bidMsgEncoded = getSendMessage(
			String(skiprate),
			this.botConfig.gasDenom,
			this.chainOperator.client.publicAddress,
			this.botConfig.skipConfig.skipBidWallet,
		);
		const [msgs, nrOfWasms] = this.messageFunction(
			arbTrade,
			this.chainOperator.client.publicAddress,
			this.botConfig.flashloanRouterAddress,
		);
		msgs.push(bidMsgEncoded);

		//if gas fee cannot be found in the botconfig based on pathlengths, pick highest available
		const TX_FEE =
			this.botConfig.txFees.get(nrOfWasms) ??
			Array.from(this.botConfig.txFees.values())[this.botConfig.txFees.size - 1];
		console.log(inspect(TX_FEE, { depth: null }));

		let res: SkipResult;
		if (toArbTrade) {
			const txToArbRaw: TxRaw = TxRaw.decode(toArbTrade.txBytes);
			res = <SkipResult>await this.chainOperator.signAndBroadcastSkipBundle(msgs, TX_FEE, undefined, txToArbRaw);
			console.log("mempool transaction to backrun: ");
			console.log(toHex(sha256(toArbTrade.txBytes)));
		} else {
			res = <SkipResult>await this.chainOperator.signAndBroadcastSkipBundle(msgs, TX_FEE, undefined, undefined);
		}
		console.log(inspect(res, { depth: null }));

		let logItem = "";
		let logMessage = `**wallet:** ${this.chainOperator.client.publicAddress}\t **block:** ${
			res.result.desired_height
		}\t **profit:** ${arbTrade.profit - skiprate}`;

		if (res.result.code !== 0) {
			logMessage += `\t **error code:** ${res.result.code}\n**error:** ${res.result.error}\n`;
		}
		if (res.result.code === 4) {
			console.log("no skip validator up, trying default broadcast");
			await this.trade(arbTrade);
		}

		if (res.result.result_check_txs != undefined) {
			res.result.result_check_txs.map(async (item, idx) => {
				if (item["code"] != "0") {
					logItem = JSON.stringify(item);

					const logMessageCheckTx = `**CheckTx Error:** index: ${idx}\t ${String(item.log)}\n`;
					logMessage = logMessage.concat(logMessageCheckTx);
					if (toArbTrade?.message.sender && idx == 0 && item["code"] == "5") {
						this.ignoreAddresses[toArbTrade.message.sender] = {
							source: false,
							timeout_at: this.iterations,
							duration: this.botConfig.skipConfig!.timout_dur,
						};
						await this.logger?.sendMessage(
							"Error on Trade from Address: " + toArbTrade.message.sender,
							LogType.Console,
						);
					}
				}
			});
		}
		if (res.result.result_deliver_txs != undefined) {
			res.result.result_deliver_txs.map(async (item, idx) => {
				if (item["code"] != "0") {
					logItem = JSON.stringify(item);

					const logMessageDeliverTx = `**DeliverTx Error:** index: ${idx}\t ${String(item.log)}\n`;
					logMessage = logMessage.concat(logMessageDeliverTx);
					if (idx == 0 && (item["code"] == 10 || item["code"] == 5)) {
						if (toArbTrade?.message.sender) {
							this.ignoreAddresses[toArbTrade.message.sender] = {
								source: false,
								timeout_at: this.iterations,
								duration: this.botConfig.skipConfig!.timout_dur,
							};
							await this.logger?.sendMessage(
								"Error on Trade from Address: " + toArbTrade.message.sender,
								LogType.Console,
							);
						}
					}
				}
			});
		}

		await this.logger?.sendMessage(logMessage, LogType.All, res.result.code);

		if (logItem.length > 0) {
			await this.logger?.sendMessage(logItem, LogType.Console);
		}

		if (res.result.code != 4) {
			this.cdPaths(arbTrade.path);
		}

		if (this.botConfig.skipConfig.trywithout && res.result.code === 4) {
			await this.trade(arbTrade);
		}

		if (res.result.code === 0) {
			this.chainOperator.client.sequence = this.chainOperator.client.sequence + 1;
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
