import { Asset, isNativeAsset } from "../types/base/asset";
import { BotConfig } from "../types/base/botConfig";
import { Path } from "../types/base/path";
import { getOptimalTrade } from "./optimizers/analyticalOptimizer";
import { PATHTIMEOUT } from "../types/arbitrageloops/mempoolLoop"

export interface OptimalTrade {
	offerAsset: Asset;
	profit: number;
	path: Path;
}
/**
 *
 */
export function trySomeArb(paths: Array<Path>, botConfig: BotConfig, errorpaths: Map<string,number> ): OptimalTrade | undefined {
	const [path, tradesize, profit] = getOptimalTrade(paths, botConfig.offerAssetInfo);

	if (path === undefined) {
		return undefined;
	} else {
		//Path to address String
		let addrs: any= new Array
		//Get Addresses from arbTrade.path.Pools and add to array
		for (let i = 0; i < path.pools.length; i++) {
			addrs.push(path.pools[i].address);        
		}
		//Needed as Key for errorpaths
		addrs=addrs.toString()
		if (errorpaths.has(addrs)&&errorpaths.get(addrs)!+PATHTIMEOUT > Date.now()){
			return undefined;
		}
		const minProfit = path.pools.length == 2 ? botConfig.profitThreshold2Hop : botConfig.profitThreshold3Hop;
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
			const offerAsset: Asset = { amount: String(tradesize), info: botConfig.offerAssetInfo };
			return { path, offerAsset, profit };
		}
	}
}
