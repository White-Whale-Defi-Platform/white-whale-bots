import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import { AllChronosMarketHistory, IndexerRestMarketChronosApi } from "@injectivelabs/sdk-ts";

import { getOrderbookMidPrice, getOrderbookSpread, Orderbook, PMMOrderbook } from "../../../types/base/orderbook";
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
export async function setPMMParameters(orderbook: PMMOrderbook, resolution: string, countback = "14") {
	const ohlc = await marketHistory(orderbook, resolution, countback);
	const ohlc0: AllChronosMarketHistory = ohlc[0];
	const midprice = getOrderbookMidPrice(orderbook);
	const atr = ATR(ohlc0, 14);

	const natr = Number.isNaN(atr / ohlc0.c[ohlc0.c.length - 1]) ? 0.008 : atr / ohlc0.c[ohlc0.c.length - 1]; //in bps

	// const candleNormalisedWidths = ohlc0.h.map((high, i) => {
	// 	return Math.abs((high - ohlc0.l[i]) / ohlc0.c[i]);
	// });
	// const averageWeightedWidth = candleNormalisedWidths.reduce((a, b) => a + b) / candleNormalisedWidths.length;
	const rsi = Number.isNaN(RSI(ohlc0, 14)) ? 50 : RSI(ohlc0, 14);

	const biDirectionalSpread = (getOrderbookSpread(orderbook, 5, 5) / midprice / 2) * 10000;
	// const spreadMultiplier = natr / averageWeightedWidth;
	const priceMultiplier = ((50 - rsi) / 50) * natr;
	console.log(
		`updating parameters for ${orderbook.ticker}: bid ${orderbook.trading.config.bidSpread} --> ${biDirectionalSpread}, ask ${orderbook.trading.config.askSpread} --> ${biDirectionalSpread}`,
		`\nprice multiplier with RSI ${rsi}: ${priceMultiplier}, shifts price from ${midprice} to ${
			(1 + priceMultiplier) * midprice
		}`,
	);
	orderbook.trading.config.askSpread = biDirectionalSpread;
	orderbook.trading.config.bidSpread = biDirectionalSpread;
	orderbook.trading.config.priceMultiplier = 1 + priceMultiplier;
}

/**
 *
 */
function ATR(candles: AllChronosMarketHistory, periods: number): number {
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
function RSI(candles: AllChronosMarketHistory, periods: number) {
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

/**
 *
 */
export function inventorySkew(pmmOrderbook: PMMOrderbook) {
	const allocatedQuoteAmount =
		pmmOrderbook.trading.config.buyOrderAmount *
		getOrderbookMidPrice(pmmOrderbook) *
		pmmOrderbook.trading.config.orderLevels;
	const baseAsset = pmmOrderbook.baseAssetInfo;
	const quoteAsset = pmmOrderbook.quoteAssetInfo;

	const baseAssetInInventory = pmmOrderbook.trading.inventory.bankBalancesList
		.filter((coin) => coin.denom === baseAsset.native_token.denom)
		.map((coin) => +coin.amount)
		.reduce((a, b) => {
			return a + b;
		});
	const quoteAssetInInventory = pmmOrderbook.trading.inventory.bankBalancesList
		.filter((coin) => coin.denom === quoteAsset.native_token.denom)
		.map((coin) => +coin.amount)
		.reduce((a, b) => {
			return a + b;
		});
	const spotAmount = baseAssetInInventory / 10 ** (pmmOrderbook.baseAssetDecimals - pmmOrderbook.quoteAssetDecimals);
	const midPrice = getOrderbookMidPrice(pmmOrderbook);

	const usableQuoteAmount = Math.min(quoteAssetInInventory, allocatedQuoteAmount);
	const skew = (spotAmount * midPrice) / (spotAmount * midPrice + usableQuoteAmount);
	return skew;
}
