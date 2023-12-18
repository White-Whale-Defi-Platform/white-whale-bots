import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import { AllChronosMarketHistory, IndexerRestMarketChronosApi } from "@injectivelabs/sdk-ts";

import { Orderbook } from "../../../types/base/orderbook";
/**
 *
 */
export default async function getMarketTA(orderbook: Orderbook, resolution: string, countback = "48") {
	const ohlc = await marketHistory(orderbook, resolution, countback);
	const ohlc0: AllChronosMarketHistory = ohlc[0];

	const atr = ATR(ohlc0, 14);

	const natr = Number.isNaN(atr / ohlc0.c[ohlc0.c.length - 1]) ? 0.008 : atr / ohlc0.c[ohlc0.c.length - 1]; //in bps

	// const candleNormalisedWidths = ohlc0.h.map((high, i) => {
	// 	return Math.abs((high - ohlc0.l[i]) / ohlc0.c[i]);
	// });
	// const averageWeightedWidth = candleNormalisedWidths.reduce((a, b) => a + b) / candleNormalisedWidths.length;
	const rsi = Number.isNaN(RSI(ohlc0, 14)) ? 50 : RSI(ohlc0, 14);
	return { rsi: rsi, natr: natr };
}

/**
 *
 */
export async function marketHistory(orderbook: Orderbook, resolution: string, countback = "48") {
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
export function ATR(candles: AllChronosMarketHistory, periods: number): number {
	const trs = [];
	for (let [i, _] of candles.h.entries()) {
		i += candles.h.length - periods - 1;
		if (i === candles.h.length - 1) {
			break;
		} else {
			trs.push(
				Math.max(
					candles.h[i] - candles.l[i],
					Math.abs(candles.h[i] - candles.c[i - 1]),
					Math.abs(candles.l[i] - candles.c[i - 1]),
				),
			);
		}
	}
	return trs.reduce((a, b) => a + b) / trs.length;
}

/**
 *
 */
export function RSI(candles: AllChronosMarketHistory, periods: number) {
	// Calculate the average of the upward price changes
	let avgUpwardChange = 0;
	let avgDownwardChange = 0;
	for (let i = candles.c.length - periods - 1; i < candles.c.length - 1; i++) {
		avgUpwardChange += Math.max(0, candles.c[i] - candles.c[i - 1]);
		avgDownwardChange += Math.max(0, candles.c[i - 1] - candles.c[i]);
	}
	avgUpwardChange /= candles.c.length;
	avgDownwardChange /= candles.c.length;

	// Calculate the RSI
	const rsi = 100 - 100 / (1 + avgUpwardChange / avgDownwardChange);

	return rsi;
}
