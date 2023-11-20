import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import { AllChronosMarketHistory, IndexerRestMarketChronosApi } from "@injectivelabs/sdk-ts";

import { getOrderbookMidPrice, Orderbook } from "../../../types/base/orderbook";
/**
 *
 */
async function marketHistory(orderbook: Orderbook, resolution: string, countback = "48") {
	const network = Network.MainnetSentry;
	const endpoints = getNetworkEndpoints(network);
	const fetcher = new IndexerRestMarketChronosApi(`${endpoints.indexer}/api/chronos/v1/market`);
	const res = await fetcher.fetchMarketsHistory({
		marketIds: [orderbook.marketId],
		resolution: resolution,
		countback: countback,
	});
	return res;
}

/**
 *
 */
export async function fetchPMMParameters(
	orderbook: Orderbook,
	resolution: string,
	countback = "48",
): Promise<[number, number]> {
	const ohlc = await marketHistory(orderbook, resolution, countback);
	const ohlc0: AllChronosMarketHistory = ohlc[0];

	const candleWidths = ohlc0.h.map((high, i) => {
		return Math.abs(high - ohlc0.l[i]) * ohlc0.v[i];
	});
	const averageWeightedWidth = candleWidths.reduce((a, b) => a + b) / ohlc0.v.reduce((a, b) => a + b, 0);

	// const sortedCandleWidths = candleWidths.sort((a, b) => a - b);
	// const mid = Math.floor(sortedCandleWidths.length / 2);
	// const medianCandleWidth =
	// 	sortedCandleWidths.length % 2 !== 0
	// 		? sortedCandleWidths[mid]
	// 		: (sortedCandleWidths[mid - 1] + sortedCandleWidths[mid]) / 2;

	// const medianCandleWeight =
	// 	sortedCandleWidths.length % 2 !== 0 ? ohlc0.v[mid] : (ohlc0.v[mid - 1] + ohlc0.v[mid]) / 2;
	// const spread = (medianCandleWidth / medianCandleWeight / getOrderbookMidPrice(orderbook)) * 10000; //in bps
	// console.log(spread,
	const spread = (averageWeightedWidth / getOrderbookMidPrice(orderbook)) * 10000;
	return [spread, spread]; //return bidspread , askspread
}
