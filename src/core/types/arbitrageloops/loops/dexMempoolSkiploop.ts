import { sha256 } from "@cosmjs/crypto";
import { toHex } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { inspect } from "util";

import { getSendMessage } from "../../../../chains/defaults/messages/getSendMessage";
import { OptimalTrade } from "../../../arbitrage/arbitrage";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { SkipResult } from "../../../chainOperator/skipclients";
import { Logger } from "../../../logging";
import { DexConfig } from "../../base/configs";
import { LogType } from "../../base/logging";
import { decodeMempool, MempoolTx } from "../../base/mempool";
import { applyMempoolMessagesOnPools, Pool } from "../../base/pool";
import { DexMempoolLoop } from "./dexMempoolloop";
/**
 *
 */
export class DexMempoolSkipLoop extends DexMempoolLoop {
	/**
	 *
	 */
	public constructor(
		chainOperator: ChainOperator,
		botConfig: DexConfig,
		logger: Logger | undefined,
		allPools: Array<Pool>,
		updateState: (chainOperator: ChainOperator, pools: Array<Pool>) => Promise<void>,
		messageFunction: (
			arbTrade: OptimalTrade,
			walletAddress: string,
			flashloancontract: string,
		) => [Array<EncodeObject>, number],
	) {
		super(chainOperator, botConfig, logger, allPools, updateState, messageFunction);
	}

	/**
	 *
	 */
	public async step(): Promise<void> {
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

			const mempoolTxs: Array<MempoolTx> = decodeMempool(
				this.mempool,
				this.ignoreAddresses,
				this.botConfig.timeoutDuration,
				this.iterations,
			);
			if (mempoolTxs.length === 0) {
				continue;
			} else {
				for (const mempoolTx of mempoolTxs) {
					applyMempoolMessagesOnPools(this.pools, [mempoolTx]);
					const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig);
					if (arbTrade) {
						await this.trade(arbTrade, mempoolTx);
						this.cdPaths(arbTrade.path);
						await this.chainOperator.reset();
						return;
					}
				}
			}
		}
	}

	// /**
	//  *
	//  */
	// async skipLiquidate(overseer: string, addressToLiquidate: string) {
	// 	const bidMsgEncoded = getSendMessage(
	// 		String(651),
	// 		this.botConfig.gasDenom,
	// 		this.chainOperator.client.publicAddress,
	// 		this.botConfig.skipConfig!.skipBidWallet,
	// 	);
	// 	const message = {
	// 		liquidate_collateral: {
	// 			borrower: addressToLiquidate,
	// 		},
	// 	};
	// 	const encodedMsgObject: EncodeObject = {
	// 		typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
	// 		value: MsgExecuteContract.fromPartial({
	// 			sender: this.chainOperator.client.publicAddress,
	// 			contract: overseer,
	// 			msg: toUtf8(JSON.stringify(message)),
	// 			funds: [],
	// 		}),
	// 	};
	// 	const msgs = [encodedMsgObject, bidMsgEncoded];
	// 	const TX_FEE: StdFee = { amount: [coin(10000, this.botConfig.gasDenom)], gas: "2800000" };

	// 	const txResponse: any = await this.chainOperator.signAndBroadcastSkipBundle(msgs, TX_FEE);
	// 	if (txResponse.result.code === 4) {
	// 		await this.sendLiquidation(overseer, addressToLiquidate);
	// 	} else if (txResponse.result.code === 0) {
	// 		this.chainOperator.client.sequence = this.chainOperator.client.sequence + 1;
	// 		await this.logger?.sendMessage("Sucessful Liquidation!!", LogType.All);
	// 	} else if (txResponse.result.code === 5) {
	// 		await addNewBorrower(
	// 			[{ overseer: overseer, address: addressToLiquidate }],
	// 			this.liquidate!,
	// 			this.chainOperator,
	// 		);
	// 	}
	// 	console.log(JSON.stringify(txResponse));
	// }

	/**
	 *
	 */
	public async trade(arbTrade: OptimalTrade, toArbTrade?: MempoolTx) {
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

		const skipFee = Math.max(Math.round(arbTrade.profit * this.botConfig.skipConfig.skipBidRate), 651);

		const bidMsgEncoded = getSendMessage(
			String(skipFee),
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
		}\t **profit:** ${arbTrade.profit - skipFee}`;

		if (res.result.code !== 0) {
			logMessage += `\t **error code:** ${res.result.code}\n**error:** ${res.result.error}\n`;
		}
		if (this.botConfig.skipConfig.tryWithoutSkip && res.result.code === 4) {
			await this.logger?.sendMessage("no skip validator up, trying default broadcast", LogType.Console);
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
							timeoutAt: this.iterations,
							duration: this.botConfig.timeoutDuration,
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
								timeoutAt: this.iterations,
								duration: this.botConfig.timeoutDuration,
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
