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
	const buys = [
		...new Set(tradeHistory.filter((st) => st.tradeDirection === TradeDirection.Buy).map((st) => st.orderHash)),
	];
	const sells = [
		...new Set(tradeHistory.filter((st) => st.tradeDirection === TradeDirection.Sell).map((st) => st.orderHash)),
	];

	const minUniqueHashes = Math.min(buys.length, sells.length);
	const buyHashes = buys.slice(0, Math.max(minUniqueHashes, 0));
	const sellHashes = sells.slice(0, Math.max(minUniqueHashes, 0));
	const buysToUse = tradeHistory.filter((st) => buyHashes.includes(st.orderHash));
	const sellsToUse = tradeHistory.filter((st) => sellHashes.includes(st.orderHash));
	for (const trade of [...buysToUse, ...sellsToUse]) {
		if (trade.tradeDirection === TradeDirection.Buy) {
			profit -= (+trade.quantity / 1e6) * +trade.price;
		}
		if (trade.tradeDirection === TradeDirection.Sell) {
			profit += (+trade.quantity / 1e6) * +trade.price;
		}
	}
	return profit;
}

/** 4 * 2 * 3
 *BUYS:           6 @ 0.000000000042.567333333333333 average
SELLS:          3 @ 0.000000000042.608999999999993 average.
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
