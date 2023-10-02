import { AssetInfo, RichAsset } from "../../types/base/asset";
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
		offerAsset: { amount: "0", info: offerAssetInfo, decimals: 6 },
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
): [number, RichAsset, number, number, number] {
	let tradesizes = [...Array(500).keys()];
	tradesizes = tradesizes.map((x) => x * 1e6);

	return binarySearch(path, offerAssetInfo, tradesizes, 0, tradesizes.length - 1);
	/**
	 *
	 */
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
): [number, RichAsset, number, number, number] {
	if (path.orderSequence === OrderSequence.AmmFirst) {
		const offerAsset: RichAsset = { amount: String(tradesize), info: offerAssetInfo, decimals: 6 };
		const outAsset0 = outGivenIn(path.pool, offerAsset);

		//we have to compensate for the precision of the market stated by the minQuantityIncrement
		outAsset0.amount = String(
			Math.floor(+outAsset0.amount / path.orderbook.minQuantityIncrement) * path.orderbook.minQuantityIncrement,
		);

		const [outGivenIn1, worstPrice, averagePrice] = OrderbookMarketSell(path.orderbook, outAsset0);
		//we have to compensate for the precision of the market stated by the minQuantityIncrement
		const outGivenInReturned =
			Math.floor(outGivenIn1 / path.orderbook.minQuantityIncrement) * path.orderbook.minQuantityIncrement;

		return [outGivenInReturned - +offerAsset.amount, offerAsset, worstPrice, averagePrice, outGivenInReturned];
	} else {
		const offerAsset: RichAsset = { amount: String(tradesize), info: path.orderbook.quoteAssetInfo, decimals: 6 };
		const [outGivenIn0, worstPrice, averagePrice] = OrderbookMarketBuy(path.orderbook, offerAsset);
		const outGivenInOrderbook =
			Math.floor(outGivenIn0 / path.orderbook.minQuantityIncrement) * path.orderbook.minQuantityIncrement;
		const outInfo0 = path.orderbook.baseAssetInfo;
		const offerAsset1 = { amount: String(outGivenInOrderbook), info: outInfo0 };
		const outAsset1 = outGivenIn(path.pool, offerAsset1);
		return [+outAsset1.amount - +offerAsset.amount, offerAsset, worstPrice, averagePrice, outGivenInOrderbook];
	}
}

/**
 *
 */
function binarySearch(
	path: OrderbookPath,
	offerAssetInfo: AssetInfo,
	arr: Array<number>,
	low: number,
	high: number,
): [number, RichAsset, number, number, number] {
	if (low === high) {
		return getProfitForTradesize(path, arr[low], offerAssetInfo);
	}
	const mid = Math.floor((low + high) / 2);
	const midValue = getProfitForTradesize(path, arr[mid], offerAssetInfo)[0];
	const leftOfMidValue = getProfitForTradesize(path, arr[mid - 1], offerAssetInfo)[0];
	const rightOfMidValue = getProfitForTradesize(path, arr[mid + 1], offerAssetInfo)[0];

	if (midValue > rightOfMidValue && midValue > leftOfMidValue) {
		return getProfitForTradesize(path, arr[mid], offerAssetInfo);
	}
	if (midValue > rightOfMidValue && midValue < leftOfMidValue) {
		return binarySearch(path, offerAssetInfo, arr, low, mid - 1);
	} else {
		return binarySearch(path, offerAssetInfo, arr, mid + 1, high);
	}
}
