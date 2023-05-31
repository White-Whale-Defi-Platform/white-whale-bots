import { fromAscii, fromBase64, fromUtf8, toUtf8 } from "@cosmjs/encoding";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { parseCoins } from "@cosmjs/stargate";
import { MsgExecuteContractCompat as MsgExecuteContractCompatBase } from "@injectivelabs/chain-api/injective/wasmx/v1/tx_pb";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

export interface Mempool {
	n_txs: string;
	total: string;
	total_bytes: string;
	txs: Array<string>;
}

export interface MempoolTx {
	message: MsgExecuteContract;
	txBytes: Uint8Array;
}

export interface IgnoredAddresses {
	[index: string]: { timeoutAt: number; duration: number };
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
export function decodeMempool(
	mempool: Mempool,
	ignoreAddresses: IgnoredAddresses,
	timeoutDur: number,
	iteration: number,
): Array<MempoolTx> {
	const decodedMessages: Array<MempoolTx> = [];
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
			let msgExecuteContract: MsgExecuteContract;

			switch (message.typeUrl) {
				case "/cosmos.bank.v1beta1.MsgSend": {
					const msgSend: MsgSend = MsgSend.decode(message.value);
					//if one of the spam wallets sends funds to a new wallet, add the new wallet to the ignore addresses
					if (ignoreAddresses[msgSend.fromAddress]) {
						discardIgnored(msgSend.fromAddress, msgSend.toAddress, ignoreAddresses, iteration);
					}
					break;
				}

				case "/injective.wasmx.v1.MsgExecuteContractCompat": {
					const msgExecuteContractCompatBase: MsgExecuteContractCompatBase =
						MsgExecuteContractCompatBase.deserializeBinary(message.value);
					const funds = msgExecuteContractCompatBase.getFunds();
					msgExecuteContract = MsgExecuteContract.fromPartial({
						contract: msgExecuteContractCompatBase.getContract(),
						sender: msgExecuteContractCompatBase.getSender(),
						msg: toUtf8(msgExecuteContractCompatBase.getMsg()),
						funds: funds === "0" ? [] : parseCoins(funds),
					});
					if (isAllowedMempoolMsg(msgExecuteContract, ignoreAddresses, iteration)) {
						decodedMessages.push({ message: msgExecuteContract, txBytes: txBytes });
					}
					break;
				}
				case "/cosmwasm.wasm.v1.MsgExecuteContract": {
					msgExecuteContract = MsgExecuteContract.decode(message.value);
					if (isAllowedMempoolMsg(msgExecuteContract, ignoreAddresses, iteration)) {
						decodedMessages.push({ message: msgExecuteContract, txBytes: txBytes });
					}
					break;
				}
				default: {
					break;
				}
			}
		}
	}
	return decodedMessages;
}
/** Function that filters out mempool transactions sent by spammers.
 * @param msg: `MsgExecuteContract` to check for correctness.
 * @param ignoreAddresses: Array containing wallet addresses that should be ignored and filtered.
 * @returns Boolean stating if `msg` is to be processed or not.
 */
function isAllowedMempoolMsg(msg: MsgExecuteContract, ignoreAddresses: IgnoredAddresses, iteration: number): boolean {
	//if the sender of the message is in our ignore list: skip this message
	if (ignoreAddresses[msg.sender]) {
		return discardIgnored(msg.sender, undefined, ignoreAddresses, iteration);
		// if they use a contract to fund new wallets
	} else if (ignoreAddresses[msg.contract]) {
		const containedMsg = JSON.parse(fromUtf8(msg.msg));
		if (containedMsg.delegate) {
			const gets = fromAscii(fromBase64(containedMsg.delegate.msg));
			return discardIgnored(msg.sender, gets, ignoreAddresses, iteration);
		}
	}
	return true;
}
/**
 *
 */
function discardIgnored(
	address: string,
	reciever: string | undefined,
	ignoreAddresses: IgnoredAddresses,
	iteration: number,
) {
	if (
		ignoreAddresses[address].timeoutAt === 0 ||
		ignoreAddresses[address].timeoutAt + ignoreAddresses[address].duration <= iteration
	) {
		if (reciever) {
			ignoreAddresses[reciever] = {
				timeoutAt: iteration,
				duration: ignoreAddresses[address].duration,
			};
		}
		ignoreAddresses[address].timeoutAt = iteration;
	} else if (ignoreAddresses[address].timeoutAt + ignoreAddresses[address].duration >= iteration) {
		delete ignoreAddresses[address];
		return true;
	}
	return false;
}
