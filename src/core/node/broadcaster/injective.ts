import { MsgBroadcasterWithPk, MsgExecuteContract } from "@injectivelabs/sdk-ts";
import { TxResponse } from "@injectivelabs/sdk-ts";
/**
 *
 */
export async function injBroadcast(broadcaster: MsgBroadcasterWithPk, msg: MsgExecuteContract): Promise<TxResponse> {
	const publicAddress = broadcaster.privateKey.toPublicKey().toAddress().address;
	const ethereumAddress = broadcaster.privateKey.toPublicKey().toAddress().getEthereumAddress();
	const tx = {
		msgs: [msg],
		injectiveAddress: publicAddress,
		ethereumAddress: ethereumAddress,
		memo: "testtxww",
	};
	return await broadcaster.broadcast(tx);
}
