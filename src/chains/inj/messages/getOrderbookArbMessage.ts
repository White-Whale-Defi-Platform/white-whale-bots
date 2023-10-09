import { EncodeObject } from "@cosmjs/proto-signing";

import { OptimalOrderbookTrade } from "../../../core/arbitrage/optimizers/orderbookOptimizer";
import { toChainAsset, toChainPrice } from "../../../core/types/base/asset";
import { OrderSequence } from "../../../core/types/base/path";
import { caclulateSpread, outGivenIn } from "../../../core/types/base/pool";
import { getSwapMessage } from "../../defaults/messages/getSwapMessage";
import { getMarketSpotOrderMessage } from "./getSpotOrderMessage";

/**
 *
 */
export function getOrderbookArbMessages(
	arbTrade: OptimalOrderbookTrade,
	publicAddress: string,
): [Array<EncodeObject>, number] {
	if (arbTrade.path.orderSequence === OrderSequence.AmmFirst) {
		//buy on the amm, transfer to trading account, sell the inj there, withdraw the usdt to injective account
		const outAsset0 = outGivenIn(arbTrade.path.pool, arbTrade.offerAsset);

		const price = toChainPrice(arbTrade.offerAsset, outAsset0);
		const spread = caclulateSpread(arbTrade.path.pool, arbTrade.offerAsset, price);
		const offerAsset = toChainAsset(arbTrade.offerAsset);

		const msg0 = getSwapMessage(arbTrade.path.pool, offerAsset, publicAddress, price, spread);

		outAsset0.amount = String(
			Math.floor(+outAsset0.amount / arbTrade.path.orderbook.minQuantityIncrement) *
				arbTrade.path.orderbook.minQuantityIncrement,
		);

		const msg1 = getMarketSpotOrderMessage(arbTrade, publicAddress, outAsset0, 2);

		return [[msg0, msg1], 2];
	} else {
		const offerAsset1 = {
			amount: String(
				Math.floor(arbTrade.outGivenIn / arbTrade.path.orderbook.minQuantityIncrement) *
					arbTrade.path.orderbook.minQuantityIncrement,
			),
			info: arbTrade.path.orderbook.baseAssetInfo,
			decimals: arbTrade.path.orderbook.baseAssetDecimals,
		};
		const msg0 = getMarketSpotOrderMessage(arbTrade, publicAddress, offerAsset1, 1);

		const outAsset1 = outGivenIn(arbTrade.path.pool, offerAsset1);

		const belief_price = toChainPrice(offerAsset1, outAsset1);
		const spread = caclulateSpread(arbTrade.path.pool, offerAsset1, belief_price);
		const offerAsset = toChainAsset(offerAsset1);

		const msg1 = getSwapMessage(arbTrade.path.pool, offerAsset, publicAddress, belief_price, spread);

		return [[msg0, msg1], 2];
	}
}
