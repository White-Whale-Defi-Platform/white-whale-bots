import { Asset, AssetInfo } from "../../types/base/asset";
import { OrderbookMarketBuy, OrderbookMarketSell } from "../../types/base/orderbook";
import { OrderbookPath, OrderSequence } from "../../types/base/path";
import { outGivenIn } from "../../types/base/pool";
import { OptimalTrade } from "../arbitrage";

export interface OptimalOrderbookTrade extends Omit<OptimalTrade, "path"> {
	worstPrice: number; //worst price for the market order to accept to fill the order
	averagePrice: number; //average price obtained by the order
	path: OrderbookPath;
	outGivenIn: number;
}
/**
 *Calculates the optimal tradesize given a CLOB and a AMM xy=k pool.
 *@param orderbook Orderbook type to arb against.
 *@param pool Pool type to arb against.
 *@param offerAsset AssetInfo type to start and end the arbitrage trade with.
 */
export function getOptimalTrade(
	paths: Array<OrderbookPath>,
	offerAssetInfo: AssetInfo,
): OptimalOrderbookTrade | undefined {
	let optimalOrderbookTrade: OptimalOrderbookTrade = {
		path: paths[0],
		offerAsset: { amount: "0", info: offerAssetInfo },
		profit: 0,
		worstPrice: 0,
		averagePrice: 0,
		outGivenIn: 0,
	};
	let optimalProfit = 0;
	for (const path of paths) {
		const [
			optimalProfitPath,
			optimalOfferAssetPath,
			optimalWorstPricePath,
			optimalAveragePricePath,
			optimalOutGivenInPath,
		] = getOptimalTradeForPath(path, offerAssetInfo);
		if (optimalProfitPath > optimalProfit) {
			optimalOrderbookTrade = {
				path: path,
				offerAsset: optimalOfferAssetPath,
				profit: optimalProfitPath,
				worstPrice: optimalWorstPricePath,
				averagePrice: optimalAveragePricePath,
				outGivenIn: optimalOutGivenInPath,
			};
			optimalProfit = optimalProfitPath;
		}
	}

	return optimalOrderbookTrade;
}

/**
 *
 */
function getOptimalTradeForPath(
	path: OrderbookPath,
	offerAssetInfo: AssetInfo,
): [number, Asset, number, number, number] {
	let tradesizes = [...Array(800).keys()];
	tradesizes = tradesizes.map((x) => x * 1e6);
	if (path.orderSequence === OrderSequence.AmmFirst) {
		let optimalTradesize = 0;
		let optimalProfit = 0;
		let optimalOfferAsset = { amount: "0", info: offerAssetInfo };
		let optimalWorstPrice = 0;
		let optimalAveragePrice = 0;
		let optimalOutGivenIn = 0;
		for (const ts of tradesizes) {
			if (ts === 0) {
				continue;
			}
			const offerAsset: Asset = { amount: String(ts), info: offerAssetInfo };
			const [outGivenIn0, outInfo0] = outGivenIn(path.pool, offerAsset);
			// console.log("amm price received: ", ts / outGivenIn0, "tradesize: ", ts, "assets received: ", outGivenIn0);
			const offerAsset1: Asset = { amount: String(outGivenIn0), info: outInfo0 };
			const [outGivenIn1, worstPrice, averagePrice] = OrderbookMarketSell(path.orderbook, offerAsset1);
			// console.log("ob price received: ", price, "usdt received: ", outGivenIn1);
			// console.log("profit: ", outGivenIn1 - ts);
			if (outGivenIn1 - ts > optimalProfit) {
				(optimalTradesize = ts),
					(optimalProfit = outGivenIn1 - ts),
					(optimalOfferAsset = offerAsset),
					(optimalWorstPrice = worstPrice),
					(optimalAveragePrice = averagePrice);
				optimalOutGivenIn = outGivenIn1;
			}
		}
		return [optimalProfit, optimalOfferAsset, optimalWorstPrice, optimalAveragePrice, optimalOutGivenIn];
	} else {
		let optimalTradesize = 0;
		let optimalProfit = 0;
		let optimalOfferAsset = { amount: "0", info: offerAssetInfo };
		let optimalWorstPrice = 0;
		let optimalAveragePrice = 0;
		let optimalOutGivenIn = 0;
		for (const ts of tradesizes) {
			if (ts === 0) {
				continue;
			}
			const offerAsset: Asset = { amount: String(ts), info: path.orderbook.quoteAssetInfo };
			const [outGivenIn0, worstPrice, averagePrice] = OrderbookMarketBuy(path.orderbook, offerAsset);
			const outInfo0 = path.orderbook.baseAssetInfo;
			const offerAsset1 = { amount: String(outGivenIn0), info: outInfo0 };
			const [outGivenIn1, outInfo1] = outGivenIn(path.pool, offerAsset1);
			if (outGivenIn1 - ts > optimalProfit) {
				(optimalTradesize = ts),
					(optimalProfit = outGivenIn1 - ts),
					(optimalOfferAsset = offerAsset),
					(optimalWorstPrice = worstPrice),
					(optimalAveragePrice = averagePrice),
					(optimalOutGivenIn = outGivenIn0);
			}
		}
		return [optimalProfit, optimalOfferAsset, optimalWorstPrice, optimalAveragePrice, optimalOutGivenIn];
	}
}
