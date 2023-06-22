import { Asset } from "../types/base/asset";
import { DexConfig, LiquidationConfig } from "../types/base/configs";
import { AnchorOverseer } from "../types/base/overseer";
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
export function trySomeArb(paths: Array<Path>, botConfig: DexConfig): OptimalTrade | undefined {
	const optimalTrade: OptimalTrade | undefined = getOptimalTrade(paths, botConfig.offerAssetInfo);

	if (!optimalTrade) {
		return undefined;
	} else {
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
export function tryLiquidationArb(
	overseers: Array<AnchorOverseer>,
	botConfig: LiquidationConfig,
): [AnchorOverseer, string] | undefined {
	for (const overseer of overseers) {
		for (const loan of Object.entries(overseer.loans)) {
			if (loan[1].riskRatio >= 1) {
				return [overseer, loan[0]];
			}
		}
	}
}

/**
 *
 */
function isAboveThreshold(botConfig: DexConfig, optimalTrade: OptimalTrade): boolean {
	// We dont know the number of message required to execute the trade, so the profit threshold will be set to the most conservative value: nr_of_pools*2-1
	const profitThreshold =
		botConfig.profitThresholds.get((optimalTrade.path.pools.length - 1) * 2 + 1) ??
		Array.from(botConfig.profitThresholds.values())[botConfig.profitThresholds.size - 1];
	if (botConfig.skipConfig) {
		const skipBidRate = botConfig.skipConfig.skipBidRate;
		return (
			(1 - skipBidRate) * optimalTrade.profit - (botConfig.flashloanFee / 100) * +optimalTrade.offerAsset.amount >
			profitThreshold
		); //profit - skipbid*profit - flashloanfee*tradesize must be bigger than the set PROFIT_THRESHOLD + TX_FEE. The TX fees dont depend on tradesize nor profit so are set in config
	} else
		return optimalTrade.profit - (botConfig.flashloanFee / 100) * +optimalTrade.offerAsset.amount > profitThreshold;
}
