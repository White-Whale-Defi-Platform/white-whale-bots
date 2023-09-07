import { Asset } from "../types/base/asset";
import { ChainConfig, LiquidationChainConfig } from "../types/base/configs";
import { AnchorOverseer } from "../types/base/overseer";
import { isOrderbookPath, OrderbookPath, Path } from "../types/base/path";
import { getOptimalTrade as getOptimalAmmTrade } from "./optimizers/analyticalOptimizer";
import { getOptimalTrade as getOptimalOrderbookTrade, OptimalOrderbookTrade } from "./optimizers/orderbookOptimizer";

export interface OptimalTrade {
	offerAsset: Asset;
	profit: number;
	path: Path;
}
/**
 *
 */
export function tryAmmArb(paths: Array<Path>, chainConfig: ChainConfig): OptimalTrade | undefined {
	const optimalTrade: OptimalTrade | undefined = getOptimalAmmTrade(paths, chainConfig.offerAssetInfo);

	if (!optimalTrade) {
		return undefined;
	} else {
		if (!isAboveThreshold(chainConfig, optimalTrade)) {
			return undefined;
		} else {
			return optimalTrade;
		}
	}
}

/**
 *
 */
export function tryOrderbookArb(
	paths: Array<OrderbookPath>,
	chainConfig: ChainConfig,
): OptimalOrderbookTrade | undefined {
	const optimalTrade: OptimalOrderbookTrade | undefined = getOptimalOrderbookTrade(paths, chainConfig.offerAssetInfo);

	if (!optimalTrade) {
		return undefined;
	} else {
		if (!isAboveThreshold(chainConfig, optimalTrade)) {
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
	chainConfig: LiquidationChainConfig,
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
function isAboveThreshold(chainConfig: ChainConfig, optimalTrade: OptimalTrade | OptimalOrderbookTrade): boolean {
	if (isOrderbookPath(optimalTrade.path)) {
		return optimalTrade.profit >= Array.from(chainConfig.profitThresholds.values())[0];
	} else {
		// We dont know the number of message required to execute the trade, so the profit threshold will be set to the most conservative value: nr_of_pools*2-1
		const profitThreshold =
			chainConfig.profitThresholds.get((optimalTrade.path.pools.length - 1) * 2 + 1) ??
			Array.from(chainConfig.profitThresholds.values())[chainConfig.profitThresholds.size - 1];
		if (chainConfig.skipConfig) {
			const skipBidRate = chainConfig.skipConfig.skipBidRate;
			return (
				(1 - skipBidRate) * optimalTrade.profit -
					(chainConfig.flashloanFee / 100) * +optimalTrade.offerAsset.amount >
				profitThreshold
			); //profit - skipbid*profit - flashloanfee*tradesize must be bigger than the set PROFIT_THRESHOLD + TX_FEE. The TX fees dont depend on tradesize nor profit so are set in config
		} else
			return (
				optimalTrade.profit - (chainConfig.flashloanFee / 100) * +optimalTrade.offerAsset.amount >
				profitThreshold
			);
	}
}
