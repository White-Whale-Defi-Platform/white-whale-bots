import { Asset } from "../types/base/asset";
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
export function trySomeArb(paths: Array<Path>, botConfig: BotConfig, errorpaths: Map<string,number>): OptimalTrade | undefined {
	const optimalTrade: OptimalTrade | undefined = getOptimalTrade(paths, botConfig.offerAssetInfo);

	if (!optimalTrade) {
		return undefined;
	} else {
		//Path to address String
		let addrs: any= new Array
		//Get Addresses from arbTrade.path.Pools and add to array
		for (let i = 0; i < optimalTrade.path.pools.length; i++) {
			addrs.push(optimalTrade.path.pools[i].address);        
		}
		//Needed as Key for errorpaths
		addrs=addrs.toString()
		if (errorpaths.has(addrs)&&errorpaths.get(addrs)!+PATHTIMEOUT > Date.now()){
			return undefined;
		}
		if (!isAboveThreshold(botConfig, optimalTrade)) {
			return undefined;
		} else {
			return optimalTrade;
		}
	}
}

/**
 *
 */
function isAboveThreshold(botConfig: BotConfig, optimalTrade: OptimalTrade): boolean {
	const profitThreshold =
		botConfig.profitThresholds.get((optimalTrade.path.pools.length - 1) * 2 + 1) ??
		Array.from(botConfig.profitThresholds.values())[botConfig.profitThresholds.size - 1];
	if (botConfig.skipConfig) {
		const skipBidRate = botConfig.skipConfig.skipBidRate;
		return (
			(1 - skipBidRate) * optimalTrade.profit - (botConfig.flashloanFee / 100) * +optimalTrade.offerAsset.amount >
			profitThreshold
		); //profit - skipbid*profit - flashloanfee*tradesize must be bigger than the set PROFIT_THRESHOLD + TX_FEE. The TX fees dont depend on tradesize nor profit
	} else
		return optimalTrade.profit - (botConfig.flashloanFee / 100) * +optimalTrade.offerAsset.amount > profitThreshold;
}
