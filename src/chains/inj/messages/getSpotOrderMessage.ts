import { MsgCreateSpotMarketOrder, OrderType, spotPriceToChainPriceToFixed } from "@injectivelabs/sdk-ts";
import { BigNumberInBase } from "@injectivelabs/utils/dist/cjs/classes";

import { Asset, isMatchingAssetInfos } from "../../../core/types/base/asset";
import { OptimalOrderbookTrade } from "../../../core/types/base/trades";
import { SpotMarketOrderMessage } from "../../../core/types/messages/spotorders";

/**
 *'/injective.exchange.v1beta1.MsgCreateSpotMarketOrder'.
 */
export function getMarketSpotOrderMessage(
	arbTrade: OptimalOrderbookTrade,
	injectiveAddress: string,
	offerAsset: Asset,
	orderType: OrderType,
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

	const orderSize = +new BigNumberInBase(offerAsset.amount).toWei(decimals).toFixed();

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
