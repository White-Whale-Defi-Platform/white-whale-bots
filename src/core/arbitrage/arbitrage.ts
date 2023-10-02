import { RichAsset } from "../types/base/asset";
import { DexConfig, LiquidationConfig } from "../types/base/configs";
import { AnchorOverseer } from "../types/base/overseer";
import { isOrderbookPath, OrderbookPath, Path } from "../types/base/path";
import { getOptimalTrade as getOptimalAmmTrade } from "./optimizers/analyticalOptimizer";
import { getOptimalTrade as getOptimalOrderbookTrade, OptimalOrderbookTrade } from "./optimizers/orderbookOptimizer";

export interface OptimalTrade {
	offerAsset: RichAsset;
	profit: number;
	path: Path;
}
/**
 *
 */
export function tryAmmArb(paths: Array<Path>, botConfig: DexConfig): OptimalTrade | undefined {
	const optimalTrade: OptimalTrade | undefined = getOptimalAmmTrade(paths, botConfig.offerAssetInfo);

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
export function tryOrderbookArb(paths: Array<OrderbookPath>, botConfig: DexConfig): OptimalOrderbookTrade | undefined {
	const optimalTrade: OptimalOrderbookTrade | undefined = getOptimalOrderbookTrade(paths, botConfig.offerAssetInfo);

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
function isAboveThreshold(botConfig: DexConfig, optimalTrade: OptimalTrade | OptimalOrderbookTrade): boolean {
	if (isOrderbookPath(optimalTrade.path)) {
		return optimalTrade.profit >= optimalTrade.path.threshold;
	} else {
		// We dont know the number of message required to execute the trade, so the profit threshold will be set to the most conservative value: nr_of_pools*2-1
		if (botConfig.skipConfig) {
			const skipBidRate = botConfig.skipConfig.skipBidRate;
			return (
				(1 - skipBidRate) * optimalTrade.profit -
					(botConfig.flashloanFee / 100) * +optimalTrade.offerAsset.amount >
				optimalTrade.path.threshold
			); //profit - skipbid*profit - flashloanfee*tradesize must be bigger than the set PROFIT_THRESHOLD + TX_FEE. The TX fees dont depend on tradesize nor profit so are set in config
		} else
			return (
				optimalTrade.profit - (botConfig.flashloanFee / 100) * +optimalTrade.offerAsset.amount >
				optimalTrade.path.threshold
			);
	}
}
