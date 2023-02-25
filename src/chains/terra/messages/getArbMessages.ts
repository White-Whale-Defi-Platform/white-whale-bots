import { toUtf8 } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { Asset, isNativeAsset } from "../../../core/types/base/asset";
import { Path } from "../../../core/types/base/path";
import { outGivenIn } from "../../../core/types/base/pool";
import { SendMessage } from "../../../core/types/messages/sendmessages";
import { DefaultSwapMessage, InnerSwapMessage } from "../../../core/types/messages/swapmessages";
/**
 *
 */
export function getArbMessages(path: Path, walletAddress: string, offerAsset0: Asset) {
	const [outGivenIn0, returnAssetInfo0] = outGivenIn(path.pools[0], offerAsset0);
	const beliefPrice0 = +offerAsset0.amount / outGivenIn0; //gives price per token bought
	const offerAsset1: Asset = { amount: String(outGivenIn0), info: returnAssetInfo0 };
	const [outGivenIn1, returnAssetInfo1] = outGivenIn(path.pools[1], offerAsset1);
	const beliefPrice1 = +offerAsset1.amount / outGivenIn1; //gives price per token bought
	console.log("outGivenIn0: ", outGivenIn0, "outGivenIn1: ", outGivenIn1);
	if (isNativeAsset(returnAssetInfo0)) {
		// double swap message as we trade only native assets
		const swapMsg0: DefaultSwapMessage = {
			swap: {
				max_spread: "0.0005",
				offer_asset: offerAsset0,
				belief_price: String(beliefPrice0),
			},
		};
		const swapMsg1: DefaultSwapMessage = {
			swap: {
				max_spread: "0.0005",
				offer_asset: offerAsset1,
				belief_price: String(beliefPrice1),
			},
		};
		return [swapMsg0, swapMsg1].map((msg, index) => {
			const encodedMsgObject: EncodeObject = {
				typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
				value: MsgExecuteContract.fromPartial({
					sender: walletAddress,
					contract: path.pools[index].address,
					msg: toUtf8(JSON.stringify(msg)),
					funds: [
						{
							amount: String(msg.swap.offer_asset.amount),
							denom: isNativeAsset(msg.swap.offer_asset.info)
								? msg.swap.offer_asset.info.native_token.denom
								: msg.swap.offer_asset.info.token.contract_addr,
						},
					],
				}),
			};
			return encodedMsgObject;
		});
	} else {
		// not both assets are native, we trade a native token into a cw20
		const swapMsg0: DefaultSwapMessage = {
			swap: { max_spread: "0.0005", offer_asset: offerAsset0, belief_price: String(beliefPrice0) },
		};
		const innerSwapMsg: InnerSwapMessage = { swap: { belief_price: String(beliefPrice1), max_spread: "0.0005" } };
		const objJsonStr = JSON.stringify(innerSwapMsg);
		const objJsonB64 = Buffer.from(objJsonStr).toString("base64");

		const sendMsg: SendMessage = {
			send: { msg: objJsonB64, amount: String(outGivenIn0), contract: path.pools[1].address },
		};

		const msg0: EncodeObject = {
			typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
			value: MsgExecuteContract.fromPartial({
				sender: walletAddress,
				contract: path.pools[0].address,
				msg: toUtf8(JSON.stringify(swapMsg0)),
				funds: [
					{
						amount: String(swapMsg0.swap.offer_asset.amount),
						denom: isNativeAsset(swapMsg0.swap.offer_asset.info)
							? swapMsg0.swap.offer_asset.info.native_token.denom
							: swapMsg0.swap.offer_asset.info.token.contract_addr,
					},
				],
			}),
		};

		const msg1: EncodeObject = {
			typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
			value: MsgExecuteContract.fromPartial({
				sender: walletAddress,
				contract: returnAssetInfo0.token.contract_addr,

				msg: toUtf8(JSON.stringify(sendMsg)),
				funds: [],
			}),
		};
		return [msg0, msg1];
	}
}
