import { fromBase64, fromUtf8 } from "@cosmjs/encoding";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { Asset } from "./asset";
import { isSendMessage, SendMessage } from "./messages/sendmessages";
import {
	isAstroSwapOperationsMessages,
	isJunoSwapMessage,
	isJunoSwapOperationsMessage,
	isSwapMessage,
	isSwapOperationsMessage,
	isTFMSwapOperationsMessage,
	isWWSwapOperationsMessages,
	JunoSwapMessage,
	JunoSwapOperationsMessage,
	SwapMessage,
	SwapOperationsMessage,
	TFMSwapOperationsMessage,
} from "./messages/swapmessages";

export interface Mempool {
	n_txs: string;
	total: string;
	total_bytes: string;
	txs: Array<string>;
}
export interface MempoolTrade {
	contract: string;
	message:
		| SwapMessage
		| SwapOperationsMessage
		| SendMessage
		| JunoSwapMessage
		| TFMSwapOperationsMessage
		| JunoSwapOperationsMessage;
	offer_asset: Asset | undefined;
}

let txMemory: { [key: string]: boolean } = {};

/**
 *Flushes the already processed transactions from the mempool.
 */
export function flushTxMemory() {
	txMemory = {};
}

/**
 *
 */
export function showTxMemory() {
	console.log(Object.keys(txMemory).length);
}
/**
 *Filters the mempool for swaps, sends and swap operation messages.
 *@param mempool The mempool(state) to process.
 *@return An array of swap, send and swap-operation messages that exist in the `mempool`.
 */
export function processMempool(mempool: Mempool): Array<MempoolTrade> {
	const mempoolTrades = [];
	for (const tx of mempool.txs) {
		if (txMemory[tx] == true) {
			// the transaction is already processed and stored in the txMemory
			continue;
		}
		// set the transaction to processed in the txMemory
		txMemory[tx] = true;

		// decode transaction to readable object
		const txBytes = fromBase64(tx);
		const txRaw = decodeTxRaw(txBytes);
		for (const message of txRaw.body.messages) {
			if (message.typeUrl == "/cosmwasm.wasm.v1.MsgExecuteContract") {
				const msgExecuteContract: MsgExecuteContract = MsgExecuteContract.decode(message.value);
				const containedMsg = JSON.parse(fromUtf8(msgExecuteContract.msg));
				const funds = msgExecuteContract.funds;
				// check if the message is a swap message we want to add to the relevant trades
				if (isSwapMessage(containedMsg)) {
					mempoolTrades.push({
						contract: msgExecuteContract.contract,
						message: containedMsg,
						offer_asset: containedMsg.swap.offer_asset,
					});
					continue;
				}

				// check if the message is a junoswap message we want to add to the relevant trades
				else if (isJunoSwapMessage(containedMsg)) {
					mempoolTrades.push({
						contract: msgExecuteContract.contract,
						message: containedMsg,
						offer_asset: undefined,
					});
					continue;
				}

				// check if the message is a cw20-send message we want to add to the relevant trades
				else if (isSendMessage(containedMsg)) {
					const contract = containedMsg.send.contract;
					const token_addr = msgExecuteContract.contract;
					const offer_asset: Asset = {
						amount: containedMsg.send.amount,
						info: { token: { contract_addr: token_addr } },
					};
					mempoolTrades.push({
						contract: contract,
						message: containedMsg,
						offer_asset: offer_asset,
					});
					continue;
				} else if (isTFMSwapOperationsMessage(containedMsg)) {
					const offerAsset = {
						amount: containedMsg.execute_swap_operations.routes[0].offer_amount,
						info: containedMsg.execute_swap_operations.routes[0].operations[0].t_f_m_swap.offer_asset_info,
					};
					mempoolTrades.push({
						contract: containedMsg.execute_swap_operations.routes[0].operations[0].t_f_m_swap.pair_contract,
						message: containedMsg,
						offer_asset: offerAsset,
					});
				} else if (isJunoSwapOperationsMessage(containedMsg)) {
					mempoolTrades.push({
						contract: msgExecuteContract.contract,
						message: containedMsg,
						offer_asset: undefined,
					});
				}
				// check if the message is a swap-operations router message we want to add to the relevant trades
				else if (isSwapOperationsMessage(containedMsg)) {
					const operationsMessage = containedMsg.execute_swap_operations.operations;
					const offerAmount = msgExecuteContract.funds[0].amount;
					let offerAsset: Asset;
					if (isWWSwapOperationsMessages(operationsMessage)) {
						offerAsset = { amount: offerAmount, info: operationsMessage[0].terra_swap.offer_asset_info };
						mempoolTrades.push({
							contract: msgExecuteContract.contract,
							message: containedMsg,
							offer_asset: offerAsset,
						});
					}
					if (isAstroSwapOperationsMessages(operationsMessage)) {
						offerAsset = { amount: offerAmount, info: operationsMessage[0].astro_swap.offer_asset_info };
						mempoolTrades.push({
							contract: msgExecuteContract.contract,
							message: containedMsg,
							offer_asset: offerAsset,
						});
					}
				} else {
					continue;
				}
			}
		}
	}
	return mempoolTrades;
}
