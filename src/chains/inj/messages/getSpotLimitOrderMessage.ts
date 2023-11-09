import { MsgCreateSpotLimitOrder, OrderType, spotPriceToChainPriceToFixed } from "@injectivelabs/sdk-ts";
import { BigNumberInBase } from "@injectivelabs/utils/dist/cjs/classes";

import { Asset } from "../../../core/types/base/asset";
import { Orderbook } from "../../../core/types/base/orderbook";
import { SpotOrderMessage } from "../../../core/types/messages/spotorders";
/**
 *'/injective.exchange.v1beta1.MsgCreateSpotMarketOrder'.
 */
export function getSpotLimitOrderMessage(
	orderbook: Orderbook,
	price: number,
	quantity: number,
	injectiveAddress: string,
	offerAsset: Asset,
	orderType: OrderType,
) {
	const decimals = orderbook.baseAssetDecimals - orderbook.quoteAssetDecimals;

	const beliefPriceOrderbook = spotPriceToChainPriceToFixed({
		value: Math.round(price * 1000) / 1000,
		baseDecimals: orderbook.baseAssetDecimals,
		quoteDecimals: orderbook.quoteAssetDecimals,
	});

	const orderSize = +new BigNumberInBase(offerAsset.amount).toWei(decimals).toFixed();

	const marketSpotOrderMsg: SpotOrderMessage = {
		marketId: orderbook.marketId,
		subaccountId: "",
		injectiveAddress: injectiveAddress,
		orderType: orderType,
		feeRecipient: injectiveAddress,
		price: beliefPriceOrderbook,
		quantity: String(orderSize),
	};
	return {
		typeUrl: "/injective.exchange.v1beta1.MsgCreateSpotLimitOrder",
		value: MsgCreateSpotLimitOrder.fromJSON(marketSpotOrderMsg),
	};
}
