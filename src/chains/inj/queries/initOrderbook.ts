import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { AssetInfo } from "../../../core/types/base/asset";
import { DexConfig, PMMConfig } from "../../../core/types/base/configs";
import { getOrderbookMidPrice, Orderbook, PMMOrderbook } from "../../../core/types/base/orderbook";
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
		const priceIncrement = marketInfo.minPriceTickSize / 10 ** decimalAdjustment;
		const ob = identity<Orderbook>({
			baseAssetInfo: baseAssetInfo,
			quoteAssetInfo: quoteAssetInfo,
			baseAssetDecimals: marketInfo.baseToken?.decimals ?? 6,
			quoteAssetDecimals: marketInfo.quoteToken?.decimals ?? 6,
			minQuantityIncrement: quantityIncrement,
			minPriceIncrement: priceIncrement * 10 ** decimalAdjustment,
			buys: [],
			sells: [],
			marketId: orderbookAddress,
			makerFeeRate: +marketInfo.makerFeeRate,
			takerFeeRate: +marketInfo.takerFeeRate,
			ticker: marketInfo.ticker,
		});
		orderbooks.push(ob);
	}
	await getOrderbookState(chainoperator, orderbooks);
	return orderbooks;
}

/**
 *
 */
export async function initPMMOrderbooks(
	chainoperator: ChainOperator,
	orderbooks: Array<Orderbook>,
	botConfig: PMMConfig,
): Promise<Array<PMMOrderbook>> {
	const pmmOrderbooks: Array<PMMOrderbook> = [];
	const weightOfOneAll = orderbooks
		.map((ob) => {
			const marketConfig = botConfig.marketConfigs.find((mc) => mc.marketId === ob.marketId);
			if (!marketConfig) {
				return 0;
			} else {
				return marketConfig.orderAmount * getOrderbookMidPrice(ob);
			}
		})
		.reduce((a, b) => a + b);
	for (const orderbook of orderbooks) {
		const marketConfig = botConfig.marketConfigs.find((mc) => mc.marketId === orderbook.marketId);
		if (!marketConfig) {
			console.log("cannot find market config for ", orderbook.marketId);
			process.exit(1);
		} else {
			const maxCapitalUsedOrderbook =
				(botConfig.maxCapitalUsed / weightOfOneAll) *
				getOrderbookMidPrice(orderbook) *
				marketConfig.orderAmount;
			const pmmOrderbook: PMMOrderbook = {
				...orderbook,
				trading: {
					activeOrders: {
						buys: new Map(),
						sells: new Map(),
					},
					tradeHistory: {
						summary: {
							grossGainInQuote: 0,
						},
						trades: [],
					},
					buyAllowed: true,
					sellAllowed: true,
					assignedQuoteAmount: maxCapitalUsedOrderbook,
					inventorySkew: 50,
					config: {
						orderRefreshTime: botConfig.orderRefreshTime,
						bidSpread: 0,
						askSpread: 0,
						priceMultiplier: 1,
						minSpread: 0,
						maxOrderAge: 0,
						orderRefreshTolerancePct: 0,
						buyOrderAmount: marketConfig.orderAmount,
						sellOrderAmount: marketConfig.orderAmount,
						defaultOrderAmount: marketConfig.orderAmount,
						priceCeiling: getOrderbookMidPrice(orderbook) * (1 + botConfig.priceCeilingPct / 100),
						priceFloor: getOrderbookMidPrice(orderbook) * (1 - botConfig.priceFloorPct / 100),
						priceCeilingPct: botConfig.priceCeilingPct,
						priceFloorPct: botConfig.priceFloorPct,
						orderLevels: botConfig.orderLevels,
						filledOrderDelay: 0,
						maxInventorySkew: 70,
						pingPongEnabled: botConfig.pingPongEnabled,
					},
				},
			};

			// await setPMMParameters(pmmOrderbook, String(botConfig.orderRefreshTime / 60), "336");
			pmmOrderbooks.push(pmmOrderbook);
		}
	}
	return pmmOrderbooks;
}
