import { SpotTrade, TradeDirection } from "@injectivelabs/sdk-ts";

/**
 *
 */
export function calculateTradeHistoryProfit(tradeHistory: Array<SpotTrade>): number {
	let profit = 0;
	for (const trade of tradeHistory) {
		if (trade.tradeDirection === TradeDirection.Buy) {
			profit -= +trade.quantity * +trade.price;
		}
		if (trade.tradeDirection === TradeDirection.Sell) {
			profit += +trade.quantity * +trade.price;
		}
	}
	return profit;
}
