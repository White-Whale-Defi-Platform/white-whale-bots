import { EncodeObject } from "@cosmjs/proto-signing";
import { MsgSwapExactAmountIn } from "osmojs/dist/codegen/osmosis/poolmanager/v1beta1/tx";

import { Asset, NativeAssetInfo } from "../../../core/types/base/asset";
import { OsmosisDefaultPool, outGivenIn } from "../../../core/types/base/pool";

/**
 *
 */
export function getOsmosisSwapMessage(
	pool: OsmosisDefaultPool,
	offerAsset: Asset,
	walletAddress: string,
	maxSpread = 0.005,
): EncodeObject {
	const outAsset = outGivenIn(pool, offerAsset);
	return {
		typeUrl: "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
		value: MsgSwapExactAmountIn.fromPartial({
			sender: walletAddress,
			routes: [{ poolId: BigInt(pool.id), tokenOutDenom: (<NativeAssetInfo>outAsset.info).native_token.denom }],
			tokenIn: { denom: (<NativeAssetInfo>offerAsset.info).native_token.denom, amount: offerAsset.amount },
			tokenOutMinAmount: String(+outAsset.amount * (1 - maxSpread)),
		}),
	};
}
