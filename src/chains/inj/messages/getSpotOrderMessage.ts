import { MsgCreateSpotMarketOrder, spotPriceToChainPriceToFixed } from "@injectivelabs/sdk-ts";
import { BigNumberInBase } from "@injectivelabs/utils/dist/cjs/classes";

import { OptimalOrderbookTrade } from "../../../core/arbitrage/optimizers/orderbookOptimizer";
import { Asset, isMatchingAssetInfos } from "../../../core/types/base/asset";
import { SpotMarketOrderMessage } from "../../../core/types/messages/spotorders";

/**
 *'/injective.exchange.v1beta1.MsgCreateSpotMarketOrder'.
 */
export function getMarketSpotOrderMessage(
	arbTrade: OptimalOrderbookTrade,
	injectiveAddress: string,
	offerAsset: Asset,
	orderType: 1 | 2,
) {
	let decimals = 6;
	if (isMatchingAssetInfos(offerAsset.info, arbTrade.path.orderbook.baseAssetInfo)) {
		decimals = arbTrade.path.orderbook.baseAssetDecimals - arbTrade.path.orderbook.quoteAssetDecimals;
	} else {
		decimals = arbTrade.path.orderbook.quoteAssetDecimals - arbTrade.path.orderbook.quoteAssetDecimals;
	}

	const beliefPriceOrderbook = spotPriceToChainPriceToFixed({
		value: Math.round(arbTrade.worstPrice * 1000) / 1000,
		baseDecimals: arbTrade.path.orderbook.baseAssetDecimals,
		quoteDecimals: arbTrade.path.orderbook.quoteAssetDecimals,
	});

	let orderSize = +new BigNumberInBase(offerAsset.amount).toWei(decimals).toFixed();
	orderSize =
		Math.floor(+orderSize / arbTrade.path.orderbook.minQuantityIncrement) *
		arbTrade.path.orderbook.minQuantityIncrement;

	const marketSpotOrderMsg: SpotMarketOrderMessage = {
		marketId: arbTrade.path.orderbook.marketId,
		subaccountId: "",
		injectiveAddress: injectiveAddress,
		orderType: orderType,
		feeRecipient: injectiveAddress,
		price: beliefPriceOrderbook,
		quantity: String(orderSize),
	};
	return {
		typeUrl: "/injective.exchange.v1beta1.MsgCreateSpotMarketOrder",
		value: MsgCreateSpotMarketOrder.fromJSON(marketSpotOrderMsg),
	};
}
