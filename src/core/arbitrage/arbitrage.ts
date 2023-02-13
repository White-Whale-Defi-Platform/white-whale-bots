import { Asset, isNativeAsset } from "../types/base/asset";
import { BotConfig } from "../types/base/botConfig";
import { Path } from "../types/base/path";
import { getOptimalTrade } from "./optimizers/analyticalOptimizer";

export interface OptimalTrade {
	offerAsset: Asset;
	profit: number;
	path: Path;
}
/**
 *
 */
export function trySomeArb(paths: Array<Path>, botConfig: BotConfig): OptimalTrade | undefined {
	const [path, tradesize, profit] = getOptimalTrade(paths, botConfig.offerAssetInfo);

	if (path === undefined) {
		return undefined;
	} else {
		const profitThreshold =
			botConfig.profitThresholds.get(path.pools.length) ??
			Array.from(botConfig.profitThresholds.values())[botConfig.profitThresholds.size];
		if (profit < profitThreshold) {
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
			const offerAsset: Asset = { amount: String(tradesize), info: botConfig.offerAssetInfo };
			return { path, offerAsset, profit };
		}
	}
}
