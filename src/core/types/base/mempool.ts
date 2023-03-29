import { fromAscii, fromBase64, fromUtf8 } from "@cosmjs/encoding";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { isSendMessage, SendMessage } from "../messages/sendmessages";
import {
	DefaultSwapMessage,
	isAstroSwapOperationsMessages,
	isDefaultSwapMessage,
	isJunoSwapMessage,
	isJunoSwapOperationsMessage,
	isSwapMessage,
	isSwapOperationsMessage,
	isTFMSwapOperationsMessage,
	isWWSwapOperationsMessages,
	isWyndDaoSwapOperationsMessages,
	JunoSwapMessage,
	JunoSwapOperationsMessage,
	SwapOperationsMessage,
	TFMSwapOperationsMessage,
} from "../messages/swapmessages";
import { Asset, isWyndDaoNativeAsset, isWyndDaoTokenAsset } from "./asset";

export interface Mempool {
	n_txs: string;
	total: string;
	total_bytes: string;
	txs: Array<string>;
}
export interface MempoolTrade {
	contract: string;
	message:
		| DefaultSwapMessage
		| SwapOperationsMessage
		| SendMessage
		| JunoSwapMessage
		| TFMSwapOperationsMessage
		| JunoSwapOperationsMessage;
	offer_asset: Asset | undefined;
	txBytes: Uint8Array;
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
			if (
				message.typeUrl === "/cosmwasm.wasm.v1.MsgExecuteContract" ||
				message.typeUrl === "/injective.wasmx.v1.MsgExecuteContractCompat"
			) {
				const msgExecuteContract: MsgExecuteContract = MsgExecuteContract.decode(message.value);
				const containedMsg = JSON.parse(fromUtf8(msgExecuteContract.msg));

				// check if the message is a swap message we want to add to the relevant trades
				if (isDefaultSwapMessage(containedMsg)) {
					const offerAsset = containedMsg.swap.offer_asset;
					if (isWyndDaoNativeAsset(offerAsset.info)) {
						offerAsset.info = { native_token: { denom: offerAsset.info.native } };
					}
					if (isWyndDaoTokenAsset(offerAsset.info)) {
						offerAsset.info = { token: { contract_addr: offerAsset.info.token } };
					}
					mempoolTrades.push({
						contract: msgExecuteContract.contract,
						message: containedMsg,
						offer_asset: offerAsset,
						txBytes: txBytes,
					});
					continue;
				}

				// check if the message is a junoswap message we want to add to the relevant trades
				else if (isJunoSwapMessage(containedMsg)) {
					mempoolTrades.push({
						contract: msgExecuteContract.contract,
						message: containedMsg,
						offer_asset: undefined,
						txBytes: txBytes,
					});
					continue;
				}

				// check if the message is a cw20-send message we want to add to the relevant trades
				else if (isSendMessage(containedMsg)) {
					try {
						const msgJson = JSON.parse(fromAscii(fromBase64(containedMsg.send.msg)));
						if (isSwapOperationsMessage(msgJson)) {
							const mempoolTrade = processSwapOperations(
								msgJson,
								txBytes,
								undefined,
								containedMsg.send.amount,
								containedMsg.send.contract,
							);
							if (mempoolTrade) {
								mempoolTrades.push(mempoolTrade);
							}
							continue;
						} else if (isSwapMessage(msgJson)) {
							// swap message inside a send message
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
								txBytes: txBytes,
							});
							continue;
						} else {
							continue;
						}
					} catch (e) {
						console.log("cannot apply send message");
						console.log(containedMsg.send);
					}
				} else if (isTFMSwapOperationsMessage(containedMsg)) {
					const offerAsset = {
						amount: containedMsg.execute_swap_operations.routes[0].offer_amount,
						info: containedMsg.execute_swap_operations.routes[0].operations[0].t_f_m_swap.offer_asset_info,
					};
					mempoolTrades.push({
						contract: containedMsg.execute_swap_operations.routes[0].operations[0].t_f_m_swap.pair_contract,
						message: containedMsg,
						offer_asset: offerAsset,
						txBytes: txBytes,
					});
				} else if (isJunoSwapOperationsMessage(containedMsg)) {
					mempoolTrades.push({
						contract: msgExecuteContract.contract,
						message: containedMsg,
						offer_asset: undefined,
						txBytes: txBytes,
					});
				}
				// check if the message is a swap-operations router message we want to add to the relevant trades
				else if (isSwapOperationsMessage(containedMsg)) {
					const mempoolTrade = processSwapOperations(containedMsg, txBytes, msgExecuteContract);
					if (mempoolTrade) {
						mempoolTrades.push(mempoolTrade);
					}
				} else {
					continue;
				}
			}
		}
	}
	return mempoolTrades;
}

/**
 *
 */
function processSwapOperations(
	containedMsg: any,
	txBytes: Uint8Array,
	msgExecuteContract?: MsgExecuteContract,
	amount?: string,
	contractAddress?: string,
) {
	const operationsMessage = containedMsg.execute_swap_operations.operations;
	let offerAmount;
	let swapContract;
	if (msgExecuteContract !== undefined) {
		offerAmount = msgExecuteContract.funds[0].amount;
		swapContract = msgExecuteContract.contract;
	} else if (amount !== undefined && contractAddress != undefined) {
		offerAmount = amount;
		swapContract = contractAddress;
	} else {
		return undefined;
	}
	let offerAsset: Asset;
	if (isWWSwapOperationsMessages(operationsMessage)) {
		offerAsset = { amount: offerAmount, info: operationsMessage[0].terra_swap.offer_asset_info };
		return {
			contract: swapContract,
			message: containedMsg,
			offer_asset: offerAsset,
			txBytes: txBytes,
		};
	}
	if (isAstroSwapOperationsMessages(operationsMessage)) {
		offerAsset = { amount: offerAmount, info: operationsMessage[0].astro_swap.offer_asset_info };
		return {
			contract: swapContract,
			message: containedMsg,
			offer_asset: offerAsset,
			txBytes: txBytes,
		};
	}
	if (isWyndDaoSwapOperationsMessages(operationsMessage)) {
		if (isWyndDaoNativeAsset(operationsMessage[0].wyndex_swap.offer_asset_info)) {
			offerAsset = {
				amount: offerAmount,
				info: {
					native_token: { denom: operationsMessage[0].wyndex_swap.offer_asset_info.native },
				},
			};
		} else {
			offerAsset = {
				amount: offerAmount,
				info: {
					token: { contract_addr: operationsMessage[0].wyndex_swap.offer_asset_info.token },
				},
			};
		}
		return {
			contract: swapContract,
			message: containedMsg,
			offer_asset: offerAsset,
			txBytes: txBytes,
		};
	}
}
