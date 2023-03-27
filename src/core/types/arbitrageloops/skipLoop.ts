import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { EncodeObject } from "@cosmjs/proto-signing";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { SkipBundleClient } from "@skip-mev/skipjs";
import { WebClient } from "@slack/web-api";

import { getSendMessage } from "../../../chains/defaults/messages/getSendMessage";
import { OptimalTrade } from "../../arbitrage/arbitrage";
import CosmjsAdapter from "../../chainOperator/chainAdapters/cosmjs";
import { ChainOperator } from "../../chainOperator/chainoperator";
import { SkipResult } from "../../chainOperator/skipclients";
import { Logger } from "../../logging";
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
	) {
		super(pools, paths, arbitrage, updateState, messageFunction, chainOperator, botConfig, logger, pathlib);
		(this.skipClient = skipClient), (this.skipSigner = skipSigner), (this.logger = logger);
	}

	/**
	 *
	 */
	public async step(): Promise<void> {
		this.iterations++;
		this.updateStateFunction(this.chainOperator, this.pools);
		while (true) {
			const mempoolResult = await this.chainOperator.client.httpClient.execute(
				createJsonRpcRequest("unconfirmed_txs"),
			);
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
		this.chainOperator.client = <CosmjsAdapter>this.chainOperator.client;
		const bidMsgEncoded = getSendMessage(
			String(Math.max(Math.round(arbTrade.profit * this.botConfig.skipConfig.skipBidRate), 651) * (10 ^ 12)),
			"inj",
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
		const gasAmount = 750000000000000;
		const gasFee = {
			denom:
				this.botConfig.baseDenom === "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7"
					? "inj"
					: this.botConfig.baseDenom,
			amount: String(gasAmount),
		};

		const TX_FEE = { amount: [gasFee], gas: String(500000 * nrOfWasms) };

		const res = <SkipResult>await this.chainOperator.signAndBroadcastSkipBundle(msgs, TX_FEE);

		let logItem = "";
		let logMessage = `**wallet:** ${this.chainOperator.client.publicAddress}\t **block:** ${res.result.desired_height}\t **profit:** ${arbTrade.profit}`;

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

		if (res.result.code != 4) {
			this.cdPaths(arbTrade.path);
		}

		if (res.result.code === 0) {
			this.chainOperator.client.sequence += 1;
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
