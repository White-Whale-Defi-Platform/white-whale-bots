import { toUtf8 } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { Asset, isNativeAsset } from "../../../core/types/base/asset";
import { Pool } from "../../../core/types/base/pool";

/**
 *
 */
export function getSwapMessage(
	pool: Pool,
	offerAsset: Asset,
	walletAddress: string,
	beliefPrice: string,
	maxSpread = 0.005,
) {
	const msg = {
		swap: {
			max_spread: String(maxSpread),
			offer_asset: offerAsset,
			// belief_price: beliefPrice,
		},
	};
	console.log({
		funds: [
			{
				denom: isNativeAsset(offerAsset.info)
					? offerAsset.info.native_token.denom
					: offerAsset.info.token.contract_addr,
				amount: offerAsset.amount,
			},
		],
		sender: walletAddress,
		contract: pool.address,
		msg: toUtf8(JSON.stringify(msg)),
	});
	const encodedMsgObject: EncodeObject = {
		typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
		value: MsgExecuteContract.fromPartial({
			funds: [
				{
					denom: isNativeAsset(offerAsset.info)
						? offerAsset.info.native_token.denom
						: offerAsset.info.token.contract_addr,
					amount: offerAsset.amount,
				},
			],
			sender: walletAddress,
			contract: pool.address,
			msg: toUtf8(JSON.stringify(msg)),
		}),
	};
	return encodedMsgObject;
}
