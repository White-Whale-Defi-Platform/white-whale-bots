import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { AssetInfo } from "../../../core/types/base/asset";
import { DexConfig } from "../../../core/types/base/configs";
import { Orderbook } from "../../../core/types/base/orderbook";
import { identity } from "../../../core/types/identity";
import { getOrderbookState } from "./getOrderbookState";
/**
 *
 */
export async function initOrderbooks(
	chainoperator: ChainOperator,
	botConfig: DexConfig,
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
		const ob = identity<Orderbook>({
			baseAssetInfo: baseAssetInfo,
			quoteAssetInfo: quoteAssetInfo,
			baseAssetDecimals: marketInfo.baseToken?.decimals ?? 6,
			quoteAssetDecimals: marketInfo.quoteToken?.decimals ?? 6,
			minQuantityIncrement: marketInfo.minQuantityTickSize ?? 10e3,
			buys: [],
			sells: [],
			marketId: orderbookAddress,
		});
		orderbooks.push(ob);
	}
	await getOrderbookState(chainoperator, orderbooks);
	return orderbooks;
}
