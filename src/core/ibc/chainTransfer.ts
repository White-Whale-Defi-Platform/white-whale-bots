import axios, { AxiosRequestConfig } from "axios";
import { MsgTransfer } from "cosmjs-types/ibc/applications/transfer/v1/tx";

import { ChainOperator } from "../chainOperator/chainoperator";
import { Chain } from "../types/base/chain";

export interface IbcTransferOperations {
	msgs: Array<IbcTransferMessage>;
}

export interface IbcTransferMessage {
	chain_id: string;
	path: object;
	msg: string;
	msg_type_url: string;
}
/**
 *
 */
export async function getChainTransfer(sourceChain: Chain, destinationChain: Chain) {
	sourceChain.IBCAssets.forEach(async (sourceEntry, key) => {
		const destinationEntry = destinationChain.IBCAssets.get(key);
		if (destinationEntry) {
			const payload = getQueryPayload(
				sourceChain.chainOperator,
				destinationChain.chainOperator,
				sourceEntry.denom,
				destinationEntry.denom,
			);
			const axiosConfig: AxiosRequestConfig = {
				headers: {
					accept: "application/json",
					"content-type": "application/json",
				},
			};
			const res = await axios.post("https://api.skip.money/v1/fungible/msgs_direct", payload, axiosConfig);
			await delay(250);
			const ibcTransferOperations: IbcTransferOperations = res.data;
			const ibcTransferMessages = ibcTransferOperations.msgs;
			sourceChain.IBCTransferMessages.set(
				sourceEntry.denom + "->" + destinationEntry.chain_id,

				getIbcTransferMessageFromResponse(ibcTransferMessages),
			);
		}
	});
}
/**
 *
 */
function getIbcTransferMessageFromResponse(msgs: Array<IbcTransferMessage>) {
	type SkipMsgTransfer = {
		source_port: string;
		source_channel: string;
		token: { denom: string; amount: string };
		sender: string;
		receiver: string;
		timeout_height: any;
		timeout_timestamp: string;
		memo: string | undefined;
	};
	return msgs.map((msg) => {
		const skipMsg: SkipMsgTransfer = JSON.parse(msg.msg);
		return MsgTransfer.fromPartial({
			sourcePort: skipMsg.source_port,
			sourceChannel: skipMsg.source_channel,
			token: skipMsg.token,
			sender: skipMsg.sender,
			receiver: skipMsg.receiver,
			timeoutHeight: skipMsg.timeout_height,
			timeoutTimestamp: skipMsg.timeout_timestamp,
			memo: skipMsg.memo,
		});
	});
}
/**
 *
 */
function getQueryPayload(
	sourceOperator: ChainOperator,
	destOperator: ChainOperator,
	sourceDenom: string,
	destDenom: string,
) {
	return {
		chain_ids_to_addresses: {
			[sourceOperator.client.chainId]: sourceOperator.client.publicAddress,
			[destOperator.client.chainId]: destOperator.client.publicAddress,
			"axelar-dojo-1": "axelar1suhw4myyt4mhcw5270vddqh62ckemp60mg8vkq",
			"cosmoshub-4": "cosmos1suhw4myyt4mhcw5270vddqh62ckemp60lx3yap",
		},
		source_asset_denom: sourceDenom,
		source_asset_chain_id: sourceOperator.client.chainId,
		dest_asset_denom: destDenom,
		dest_asset_chain_id: destOperator.client.chainId,
		amount_in: "1000000",
		amount_out: "1000000",
	};
}
/*
    for(const asset of sourceChain.chainAssets){

    }
}
curl --request POST \
     --url https://api.skip.money/v1/fungible/msgs_direct \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data 
const payload =
*/
/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
