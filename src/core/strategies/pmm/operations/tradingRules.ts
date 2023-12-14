import { SpotLimitOrder, spotPriceToChainPriceToFixed } from "@injectivelabs/sdk-ts";
import { OrderSide, TradeDirection } from "@injectivelabs/ts-types";

import { PMMOrderbook } from "../../../types/base/orderbook";

/**
 *
 */
export const priceBasedTradeDirection = (pmmOrderbook: PMMOrderbook, midPrice: number): Array<TradeDirection> => {
	if (midPrice < pmmOrderbook.trading.config.priceFloor) {
		//below minprice we only buy
		return [TradeDirection.Buy];
	} else {
		//above maxprice we only sell
		if (midPrice > pmmOrderbook.trading.config.priceCeiling) {
			return [TradeDirection.Sell];
		} else {
			// check for skewed inventory
			if (pmmOrderbook.trading.inventorySkew > 70) {
				//too much base asset
				return [TradeDirection.Sell];
			} else if (pmmOrderbook.trading.inventorySkew < 20) {
				//too little base asset
				return [TradeDirection.Buy];
			} else {
				//within trading range and inventory not skewed, check for pingpong
				if (pmmOrderbook.trading.config.pingPongEnabled) {
					//pingpong enabled
					if (pmmOrderbook.trading.tradeHistory.trades[0].tradeDirection === TradeDirection.Buy) {
						//last trade was buy, return sell
						return [TradeDirection.Sell];
					} else {
						//last trade was sell, return buy
						return [TradeDirection.Buy];
					}
				} else {
					//no ping pong, both directions allowed
					return [TradeDirection.Sell, TradeDirection.Buy];
				}
			}
		}
	}
};

/**
 *
 */
export const validOpenOrder = (
	pmmOrderbook: PMMOrderbook,
	order: SpotLimitOrder,
	midPrice: number,
	allowedTradeDirections: Array<TradeDirection>,
) => {
	if (order.orderSide === OrderSide.Buy) {
		if (!allowedTradeDirections.includes(TradeDirection.Buy)) {
			return false;
		} else if (
			+order.price <
			+spotPriceToChainPriceToFixed({
				value: midPrice * (1 - pmmOrderbook.trading.config.bidSpread / 10000),
				baseDecimals: pmmOrderbook.baseAssetDecimals,
				quoteDecimals: pmmOrderbook.quoteAssetDecimals,
			})
		) {
			return false;
		} else {
			return true;
		}
	} else {
		if (!allowedTradeDirections.includes(TradeDirection.Sell)) {
			return false;
		} else if (
			+order.price >
			+spotPriceToChainPriceToFixed({
				value: midPrice * (1 + pmmOrderbook.trading.config.askSpread / 10000),
				baseDecimals: pmmOrderbook.baseAssetDecimals,
				quoteDecimals: pmmOrderbook.quoteAssetDecimals,
			})
		) {
			return false;
		} else {
			return true;
		}
	}
};
