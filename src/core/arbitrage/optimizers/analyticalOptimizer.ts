import { AssetInfo } from "../../types/base/asset";
import { Path } from "../../types/base/path";
import { getAssetsOrder, outGivenIn } from "../../types/base/pool";
import { OptimalTrade, TradeType } from "../../types/base/trades";

/** Function to calculate the optimal path, tradesize and profit given an Array of paths and a starting asset.
 * @param paths Type `Array<Path>` to check for arbitrage.
 * @param offerAssetInfo Type `AssetInfo` to start the arbitrage from.
 */
export function getOptimalTrade(paths: Array<Path>, offerAssetInfo: AssetInfo): OptimalTrade | undefined {
	let maxTradesize = 0;
	let maxProfit = 0;
	let maxPath;

	paths.map((path: Path) => {
		const [tradesize, profit] = getOptimalTradeForPath(path, offerAssetInfo);
		if (profit > maxProfit && tradesize > 0) {
			maxProfit = profit;
			maxTradesize = tradesize;
			maxPath = path;
		}
	});
	if (maxPath) {
		return {
			tradeType: TradeType.AMM,
			path: maxPath,
			offerAsset: { amount: String(maxTradesize), info: offerAssetInfo, decimals: 6 },
			profit: maxProfit,
		};
	} else {
		return undefined;
	}
}

/** Given an ordered route, calculate the optimal amount into the first pool that maximizes the profit of swapping through the route
*	Implements n-pool cylic arb from this paper: https://arxiv.org/abs/2105.02784.
*	Extends algo to have varying swap fees for each pool.
    @param path Path of type `Path` to calculate the optimal tradesize for.
	@param offerAssetInfo OfferAsset type `AssetInfo` from which the arbitrage path starts. 
    @returns [optimal tradesize, expected profit] for this particular path.
 */
export function getOptimalTradeForPath(path: Path, offerAssetInfo: AssetInfo): [number, number] {
	const assetBalances = [];
	let offerAssetNext = offerAssetInfo;
	for (let i = 0; i < path.pools.length; i++) {
		const [inAsset, outAsset] = getAssetsOrder(path.pools[i], offerAssetNext) ?? [];
		offerAssetNext = outAsset.info;
		assetBalances.push([+inAsset.amount, +outAsset.amount]);
	}

	// # Set the aprime_in and aprime_out to the first pool in the route
	let [aprime_in, aprime_out] = assetBalances[0];

	// # Set the r1_first and r2_first to the first pool in the route
	const [r1_first, r2_first] = [1 - path.pools[0].inputfee / 100, 1 - path.pools[0].outputfee / 100];

	// # Iterate through the route
	for (let i = 1; i < assetBalances.length; i++) {
		// # Set the a_in and a_out to the current pool in the route
		const [a_in, a_out] = assetBalances[i];
		// # Set the r1 and r2 to the current pool in the route
		const [r1, r2] = [1 - path.pools[i].inputfee / 100, 1 - path.pools[i].outputfee / 100];
		// # Calculate the aprime_in
		aprime_in = (aprime_in * a_in) / (a_in + r1 * r2 * aprime_out);
		// # Calculate the aprime_out
		aprime_out = (r1 * r2 * aprime_out * a_out) / (a_in + r1 * r2 * aprime_out);
	}
	// # Calculate the delta_a
	const delta_a = (Math.sqrt(r1_first * r2_first * aprime_in * aprime_out) - aprime_in) / r1_first;

	let currentOfferAsset = { amount: String(delta_a), info: offerAssetInfo };
	for (let i = 0; i < path.pools.length; i++) {
		const outAsset = outGivenIn(path.pools[i], currentOfferAsset);
		currentOfferAsset = outAsset;
	}
	const profit = +currentOfferAsset.amount - delta_a;

	// # Return the floor of delta_a
	return [delta_a, profit];
}
