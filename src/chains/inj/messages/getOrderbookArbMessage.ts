import { EncodeObject } from "@cosmjs/proto-signing";

import { OptimalOrderbookTrade } from "../../../core/arbitrage/optimizers/orderbookOptimizer";
import { toChainAsset, toChainPrice } from "../../../core/types/base/asset";
import { OrderSequence } from "../../../core/types/base/path";
import { outGivenIn } from "../../../core/types/base/pool";
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
		const [outGivenIn0, outInfo0] = outGivenIn(arbTrade.path.pool, arbTrade.offerAsset);

		const price = toChainPrice(arbTrade.offerAsset, { amount: String(outGivenIn0), info: outInfo0 });
		const offerAsset = toChainAsset(arbTrade.offerAsset);
		const msg0 = getSwapMessage(arbTrade.path.pool, offerAsset, publicAddress, price);

		const offerAsset1 = {
			amount: String(
				Math.floor(outGivenIn0 / arbTrade.path.orderbook.minQuantityIncrement) *
					arbTrade.path.orderbook.minQuantityIncrement,
			),
			info: outInfo0,
		};

		const msg1 = getMarketSpotOrderMessage(arbTrade, publicAddress, offerAsset1, 2);

		return [[msg0, msg1], 2];
	} else {
		const offerAsset1 = {
			amount: String(arbTrade.outGivenIn),
			info: arbTrade.path.orderbook.baseAssetInfo,
		};
		const msg0 = getMarketSpotOrderMessage(arbTrade, publicAddress, offerAsset1, 1);

		const [outGivenIn1, outInfo1] = outGivenIn(arbTrade.path.pool, {
			amount: String(arbTrade.outGivenIn),
			info: offerAsset1.info,
		});

		const belief_price = toChainPrice(
			{
				amount: String(arbTrade.outGivenIn),
				info: offerAsset1.info,
			},
			{ amount: String(outGivenIn1), info: outInfo1 },
		);
		const offerAsset = toChainAsset({
			amount: String(arbTrade.outGivenIn),
			info: offerAsset1.info,
		});

		const msg1 = getSwapMessage(arbTrade.path.pool, offerAsset, publicAddress, belief_price);

		return [[msg0, msg1], 2];
	}
}
