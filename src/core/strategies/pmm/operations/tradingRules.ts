import { TradeDirection } from "@injectivelabs/ts-types";

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
			//within trading range, check for pingpong
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
};
