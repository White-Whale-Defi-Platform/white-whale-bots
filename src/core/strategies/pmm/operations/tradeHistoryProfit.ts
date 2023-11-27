import {
	AccountPortfolioV2,
	spotQuantityFromChainQuantityToFixed,
	SpotTrade,
	TradeDirection,
} from "@injectivelabs/sdk-ts";

import { getOrderbookMidPrice, Orderbook } from "../../../types/base/orderbook";

/**
 *
 */
export function calculateTradeHistoryProfit(orderbook: Orderbook, tradeHistory: Array<SpotTrade>): number {
	let profit = 0;
	const buys = tradeHistory.filter((st) => st.tradeDirection === TradeDirection.Buy);
	const sells = tradeHistory.filter((st) => st.tradeDirection === TradeDirection.Sell);
	const leastTrades = Math.min(buys.length, sells.length);

	const buysToUse = buys.slice(0, Math.max(leastTrades, 0));
	const sellsToUse = sells.slice(0, Math.max(leastTrades, 0));
	for (const trade of [...buysToUse, ...sellsToUse]) {
		if (trade.tradeDirection === TradeDirection.Buy) {
			profit -= +trade.quantity * +trade.price;
		}
		if (trade.tradeDirection === TradeDirection.Sell) {
			profit += +trade.quantity * +trade.price;
		}
	}
	return +spotQuantityFromChainQuantityToFixed({
		value: profit,
		baseDecimals: orderbook.quoteAssetDecimals,
		decimalPlaces: 4,
	});
}

/**
 *
 */
export function calculatePortfolioValue(orderbook: Orderbook, portfolio: AccountPortfolioV2): number {
	const midPrice = getOrderbookMidPrice(orderbook);
	let accountValueInQuote = 0;
	for (const balance of portfolio.bankBalancesList) {
		if (balance.denom === orderbook.baseAssetInfo.native_token.denom) {
			accountValueInQuote +=
				+spotQuantityFromChainQuantityToFixed({
					value: balance.amount,
					baseDecimals: orderbook.baseAssetDecimals,
				}) * midPrice;
		}
		if (balance.denom === orderbook.quoteAssetInfo.native_token.denom) {
			accountValueInQuote += +spotQuantityFromChainQuantityToFixed({
				value: balance.amount,
				baseDecimals: orderbook.quoteAssetDecimals,
			});
		}
	}
	return accountValueInQuote;
}
