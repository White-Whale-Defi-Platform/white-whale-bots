import { toUtf8 } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { Asset, isMatchingAssetInfos, isNativeAsset } from "../../../core/types/base/asset";
import { Path } from "../../../core/types/base/path";
import { AmmDexName, outGivenIn } from "../../../core/types/base/pool";
import { SendMessage } from "../../../core/types/messages/sendmessages";
import { DefaultSwapMessage, InnerSwapMessage, JunoSwapMessage } from "../../../core/types/messages/swapmessages";
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
		let swapMsg0: DefaultSwapMessage | JunoSwapMessage;
		let encodedSwapMsg0: EncodeObject;
		if (path.pools[0].dexname == AmmDexName.default) {
			swapMsg0 = {
				swap: {
					max_spread: "0.0005",
					offer_asset: offerAsset0,
					belief_price: String(beliefPrice0),
				},
			};
			encodedSwapMsg0 = {
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
		} else {
			swapMsg0 = {
				swap: {
					input_token: isMatchingAssetInfos(path.pools[0].assets[0].info, offerAsset0.info)
						? "Token1"
						: "Token2",
					input_amount: offerAsset0.amount,
					min_output: String(outGivenIn0),
				},
			};
			encodedSwapMsg0 = {
				typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
				value: MsgExecuteContract.fromPartial({
					sender: walletAddress,
					contract: path.pools[0].address,
					msg: toUtf8(JSON.stringify(swapMsg0)),
					funds: [
						{
							amount: String(swapMsg0.swap.input_amount),
							denom: isNativeAsset(offerAsset0.info)
								? offerAsset0.info.native_token.denom
								: offerAsset0.info.token.contract_addr,
						},
					],
				}),
			};
		}

		let swapMsg1: DefaultSwapMessage | JunoSwapMessage;
		let encodedSwapMsg1: EncodeObject;
		if (path.pools[1].dexname == AmmDexName.default) {
			swapMsg1 = {
				swap: {
					max_spread: "0.0005",
					offer_asset: offerAsset1,
					belief_price: String(beliefPrice1),
				},
			};
			encodedSwapMsg1 = {
				typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
				value: MsgExecuteContract.fromPartial({
					sender: walletAddress,
					contract: path.pools[1].address,
					msg: toUtf8(JSON.stringify(swapMsg1)),
					funds: [
						{
							amount: String(swapMsg1.swap.offer_asset.amount),
							denom: isNativeAsset(swapMsg1.swap.offer_asset.info)
								? swapMsg1.swap.offer_asset.info.native_token.denom
								: swapMsg1.swap.offer_asset.info.token.contract_addr,
						},
					],
				}),
			};
		} else {
			swapMsg1 = {
				swap: {
					input_token: isMatchingAssetInfos(path.pools[1].assets[0].info, offerAsset1.info)
						? "Token1"
						: "Token2",
					input_amount: offerAsset1.amount,
					min_output: String(outGivenIn1),
				},
			};
			encodedSwapMsg1 = {
				typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
				value: MsgExecuteContract.fromPartial({
					sender: walletAddress,
					contract: path.pools[1].address,
					msg: toUtf8(JSON.stringify(swapMsg1)),
					funds: [
						{
							amount: String(swapMsg1.swap.input_amount),
							denom: isNativeAsset(offerAsset1.info)
								? offerAsset1.info.native_token.denom
								: offerAsset1.info.token.contract_addr,
						},
					],
				}),
			};
		}
		return [encodedSwapMsg0, encodedSwapMsg1];
	} else {
		let swapMsg0: DefaultSwapMessage | JunoSwapMessage;
		let encodedSwapMsg0: EncodeObject;
		if (path.pools[0].dexname == AmmDexName.default) {
			swapMsg0 = {
				swap: {
					max_spread: "0.0005",
					offer_asset: offerAsset0,
					belief_price: String(beliefPrice0),
				},
			};
			encodedSwapMsg0 = {
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
		} else {
			swapMsg0 = {
				swap: {
					input_token: isMatchingAssetInfos(path.pools[0].assets[0].info, offerAsset0.info)
						? "Token1"
						: "Token2",
					input_amount: offerAsset0.amount,
					min_output: String(outGivenIn0),
				},
			};
			encodedSwapMsg0 = {
				typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
				value: MsgExecuteContract.fromPartial({
					sender: walletAddress,
					contract: path.pools[0].address,
					msg: toUtf8(JSON.stringify(swapMsg0)),
					funds: [
						{
							amount: String(swapMsg0.swap.input_amount),
							denom: isNativeAsset(offerAsset0.info)
								? offerAsset0.info.native_token.denom
								: offerAsset0.info.token.contract_addr,
						},
					],
				}),
			};
		}

		let swapMsg1: SendMessage | JunoSwapMessage;
		let encodedSwapMsg1: EncodeObject;
		if (path.pools[1].dexname == AmmDexName.default) {
			const innerSwapMsg: InnerSwapMessage = {
				swap: { belief_price: String(beliefPrice1), max_spread: "0.0005" },
			};
			const objJsonStr = JSON.stringify(innerSwapMsg);
			const objJsonB64 = Buffer.from(objJsonStr).toString("base64");
			swapMsg1 = {
				send: {
					amount: offerAsset1.amount,
					contract: path.pools[1].address,
					msg: objJsonB64,
				},
			};
			encodedSwapMsg1 = {
				typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
				value: MsgExecuteContract.fromPartial({
					sender: walletAddress,
					contract: returnAssetInfo0.token.contract_addr,

					msg: toUtf8(JSON.stringify(swapMsg1)),
					funds: [],
				}),
			};
		} else {
			swapMsg1 = {
				swap: {
					input_token: isMatchingAssetInfos(path.pools[1].assets[0].info, offerAsset1.info)
						? "Token1"
						: "Token2",
					input_amount: offerAsset1.amount,
					min_output: String(outGivenIn1),
				},
			};
			encodedSwapMsg1 = {
				typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
				value: MsgExecuteContract.fromPartial({
					sender: walletAddress,
					contract: path.pools[1].address,
					msg: toUtf8(JSON.stringify(swapMsg1)),
					funds: [
						{
							amount: String(swapMsg1.swap.input_amount),
							denom: isNativeAsset(offerAsset1.info)
								? offerAsset1.info.native_token.denom
								: offerAsset1.info.token.contract_addr,
						},
					],
				}),
			};
		}
		return [encodedSwapMsg0, encodedSwapMsg1];
	}
}
