import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { AssetInfo } from "../../../core/types/base/asset";
import { DexConfig, PMMConfig } from "../../../core/types/base/configs";
import { Orderbook } from "../../../core/types/base/orderbook";
import { identity } from "../../../core/types/identity";
import { getOrderbookState } from "./getOrderbookState";
/**
 *
 */
export async function initOrderbooks(
	chainoperator: ChainOperator,
	botConfig: DexConfig | PMMConfig,
): Promise<Array<Orderbook> | undefined> {
	const orderbooks: Array<Orderbook> = [];
	for (const orderbookAddress of botConfig.orderbooks) {
		const marketInfo = await chainoperator.queryMarket(orderbookAddress);
		if (!marketInfo) {
			console.log("cannot fetch market: ", orderbookAddress);
			return;
		}
		const baseAssetInfo: AssetInfo = { native_token: { denom: marketInfo.baseDenom } };
		const quoteAssetInfo: AssetInfo = { native_token: { denom: marketInfo.quoteDenom } };

		const decimalAdjustment = (marketInfo.baseToken?.decimals ?? 6) - (marketInfo.quoteToken?.decimals ?? 6);
		const quantityIncrement = marketInfo.minQuantityTickSize / 10 ** decimalAdjustment;
		const ob = identity<Orderbook>({
			baseAssetInfo: baseAssetInfo,
			quoteAssetInfo: quoteAssetInfo,
			baseAssetDecimals: marketInfo.baseToken?.decimals ?? 6,
			quoteAssetDecimals: marketInfo.quoteToken?.decimals ?? 6,
			minQuantityIncrement: quantityIncrement,
			buys: [],
			sells: [],
			marketId: orderbookAddress,
			makerFeeRate: +marketInfo.makerFeeRate,
			takerFeeRate: +marketInfo.takerFeeRate,
		});
		orderbooks.push(ob);
	}
	await getOrderbookState(chainoperator, orderbooks);
	return orderbooks;
}
