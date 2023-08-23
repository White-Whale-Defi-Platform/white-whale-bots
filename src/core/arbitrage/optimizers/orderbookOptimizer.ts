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
	return optimalProfit > 0 ? optimalOrderbookTrade : undefined;
}

/**
 *
 */
function getOptimalTradeForPath(
	path: OrderbookPath,
	offerAssetInfo: AssetInfo,
): [number, Asset, number, number, number] {
	let tradesizes = [...Array(900).keys()];
	tradesizes = tradesizes.map((x) => x * 1e6);

	let leftIndex = 0;
	let rightIndex = tradesizes.length - 1;
	let guessIndex = 0;
	while (leftIndex < rightIndex) {
		guessIndex = Math.floor((leftIndex + rightIndex) / 2);
		if (
			getProfitForTradesize(path, tradesizes[guessIndex], offerAssetInfo)[0] <
			getProfitForTradesize(path, tradesizes[guessIndex + 1], offerAssetInfo)[0]
		) {
			leftIndex = guessIndex + 1;
		} else if (
			getProfitForTradesize(path, tradesizes[guessIndex], offerAssetInfo)[0] >
			getProfitForTradesize(path, tradesizes[guessIndex + 1], offerAssetInfo)[0]
		) {
			rightIndex = guessIndex;
		}
	}
	return getProfitForTradesize(path, tradesizes[guessIndex], offerAssetInfo);
}

/**
 * Calculates profit for a given Path and Tradesize.
 * @param tradesize Tradesize to check profit for.
 * @param path OrderbookPath to check the profit for.
 * @returns Array containing `[profit, received assets, worst price orderbook, average price of the trade]`.
 */
function getProfitForTradesize(
	path: OrderbookPath,
	tradesize: number,
	offerAssetInfo: AssetInfo,
): [number, Asset, number, number, number] {
	if (path.orderSequence === OrderSequence.AmmFirst) {
		const offerAsset: Asset = { amount: String(tradesize), info: offerAssetInfo };
		const [outGivenIn0, outInfo0] = outGivenIn(path.pool, offerAsset);
		// console.log("amm price received: ", ts / outGivenIn0, "tradesize: ", ts, "assets received: ", outGivenIn0);
		const offerAsset1: Asset = { amount: String(outGivenIn0), info: outInfo0 };
		const [outGivenIn1, worstPrice, averagePrice] = OrderbookMarketSell(path.orderbook, offerAsset1);
		return [outGivenIn1 - +offerAsset.amount, offerAsset, worstPrice, averagePrice, outGivenIn1];
	} else {
		const offerAsset: Asset = { amount: String(tradesize), info: path.orderbook.quoteAssetInfo };
		const [outGivenIn0, worstPrice, averagePrice] = OrderbookMarketBuy(path.orderbook, offerAsset);
		const outInfo0 = path.orderbook.baseAssetInfo;
		const offerAsset1 = { amount: String(outGivenIn0), info: outInfo0 };
		const [outGivenIn1, outInfo1] = outGivenIn(path.pool, offerAsset1);
		return [outGivenIn1 - +offerAsset.amount, offerAsset, worstPrice, averagePrice, outGivenIn0];
	}
}
