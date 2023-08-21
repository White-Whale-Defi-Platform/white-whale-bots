import { BigNumberInBase } from "@injectivelabs/utils/dist/cjs/classes";

import { OptimalOrderbookTrade } from "../../../core/arbitrage/optimizers/orderbookOptimizer";
import { toChainAsset, toChainPrice } from "../../../core/types/base/asset";
import { OrderSequence } from "../../../core/types/base/path";
import { outGivenIn } from "../../../core/types/base/pool";
import { getSwapMessage } from "../../defaults/messages/getSwapMessage";
import { getMarketSpotOrderMessage } from "./getSpotOrderMessage";

/**
 *
 */
export function getOrderbookArbMessages(arbTrade: OptimalOrderbookTrade, publicAddress: string) {
	if (arbTrade.path.orderSequence === OrderSequence.AmmFirst) {
		//buy on the amm, transfer to trading account, sell the inj there, withdraw the usdt to injective account
		const [outGivenIn0, outInfo0] = outGivenIn(arbTrade.path.pool, arbTrade.offerAsset);

		const price = toChainPrice(arbTrade.offerAsset, { amount: String(outGivenIn0), info: outInfo0 });
		const offerAsset = toChainAsset(arbTrade.offerAsset);
		const msg0 = getSwapMessage(arbTrade.path.pool, offerAsset, publicAddress, price);

		const offerAsset1 = {
			amount: String(outGivenIn0),
			info: outInfo0,
		};

		const msg1 = getMarketSpotOrderMessage(arbTrade, publicAddress, offerAsset1, 2);

		return [msg0, msg1];
	} else {
		const offerAsset1 = {
			amount: String(arbTrade.outGivenIn),
			info: arbTrade.path.orderbook.baseAssetInfo,
		};
		const msg0 = getMarketSpotOrderMessage(arbTrade, publicAddress, offerAsset1, 1);

		const decimals = arbTrade.path.orderbook.baseAssetDecimals - arbTrade.path.orderbook.quoteAssetDecimals;

		let orderSize = +new BigNumberInBase(arbTrade.outGivenIn).toWei(decimals).toFixed();

		const belief_price = String(
			Math.round((orderSize / arbTrade.outGivenIn) * 100000 * (10 ^ decimals)) / 100000 / (10 ^ decimals),
		);
		orderSize =
			Math.floor(orderSize / arbTrade.path.orderbook.minQuantityIncrement) *
			arbTrade.path.orderbook.minQuantityIncrement;

		const offerAsset = {
			amount: String(orderSize),
			info: offerAsset1.info,
		};
		const msg1 = getSwapMessage(arbTrade.path.pool, offerAsset, publicAddress, belief_price);

		return [msg0, msg1];
	}
}
