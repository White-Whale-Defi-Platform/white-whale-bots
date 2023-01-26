import { Asset, AssetInfo, isNativeAsset } from "./../types/core/asset";
import { Path } from "./../types/core/path";
import { getOptimalTrade } from "./optimizers/analyticalOptimizer";

export interface OptimalTrade {
	offerAsset: Asset;
	profit: number;
	path: Path;
}
/**
 *
 */
export function trySomeArb(
	paths: Array<Path>,
	offerAssetInfo: AssetInfo,
	[minProfit2Hop, minProfit3Hop]: [number, number],
): OptimalTrade | undefined {
	const [path, tradesize, profit] = getOptimalTrade(paths, offerAssetInfo);

	if (path === undefined) {
		return undefined;
	} else {
		const minProfit = path.pools.length == 2 ? minProfit2Hop : minProfit3Hop;
		if (profit * 0.997 < minProfit) {
			return undefined;
		} else {
			console.log("optimal tradesize: ", tradesize, " with profit: ", profit);
			console.log("path: "),
				path.pools.map((pool) => {
					console.log(
						pool.address,
						isNativeAsset(pool.assets[0].info)
							? pool.assets[0].info.native_token.denom
							: pool.assets[0].info.token.contract_addr,
						pool.assets[0].amount,
						isNativeAsset(pool.assets[1].info)
							? pool.assets[1].info.native_token.denom
							: pool.assets[1].info.token.contract_addr,
						pool.assets[1].amount,
					);
				});
			const offerAsset: Asset = { amount: String(tradesize), info: offerAssetInfo };
			return { path, offerAsset, profit };
		}
	}
}
