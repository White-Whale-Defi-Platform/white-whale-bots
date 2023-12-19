import { SpotLimitOrder, SpotTrade } from "@injectivelabs/sdk-ts";
import { TradeDirection } from "@injectivelabs/ts-types";

import { Asset, NativeAssetInfo } from "./asset";
export interface Order {
	price: number;
	quantity: number;
	type: "sell" | "buy";
}
export interface Orderbook {
	marketId: string; //contractaddress or marketid
	baseAssetInfo: NativeAssetInfo;
	quoteAssetInfo: NativeAssetInfo;
	baseAssetDecimals: number;
	quoteAssetDecimals: number;
	minQuantityIncrement: number;
	minPriceIncrement: number;
	buys: Array<Order>;
	sells: Array<Order>;
	makerFeeRate: number;
	takerFeeRate: number;
	ticker: string;
}
export interface PMMOrderbook extends Orderbook {
	trading: {
		activeOrders: { buys: Map<string, SpotLimitOrder>; sells: Map<string, SpotLimitOrder> };
		tradeHistory: {
			summary: { grossGainInQuote: number };
			trades: Array<SpotTrade>;
		};
		allowedTradeDirections: Array<TradeDirection>;
		inventorySkew: number;
		assignedQuoteAmount: number;
		config: {
			orderRefreshTime: number;
			bidSpread: number;
			askSpread: number;
			minSpread: number;
			priceMultiplier: number;
			maxOrderAge: number;
			orderRefreshTolerancePct: number;
			buyOrderAmount: number;
			sellOrderAmount: number;
			defaultOrderAmount: number;
			priceCeiling: number;
			priceFloor: number;
			priceCeilingPct: number;
			priceFloorPct: number;
			orderLevels: number;
			filledOrderDelay: number;
			maxInventorySkew: number;
			pingPongEnabled: boolean;
		};
	};
}
/**
 * Market sell the offered asset, meaning it should be matched to the buy side of the orderbook.
 * @param orderbook Orderbook type to sell on.
 * @param offerAsset Asset type to sell.
 * @return [number, number] the received asset amount and average price.
 */
export function OrderbookMarketSell(orderbook: Orderbook, offerAsset: Asset) {
	//we are selling the base asset
	let rest = Math.floor(+offerAsset.amount);
	let result = 0;
	let buyIndex = 0;
	while (rest > 0) {
		const currentBuy = orderbook.buys[buyIndex];
		const currentOrderSize = currentBuy.quantity > rest ? rest : currentBuy.quantity;
		rest = rest - Math.floor(currentOrderSize);
		result = result + Math.floor(currentOrderSize * currentBuy.price);
		buyIndex = buyIndex + 1;
	}
	result = Math.floor((1 - orderbook.takerFeeRate * 2) * result);
	return [result, orderbook.buys[buyIndex].price, result / +offerAsset.amount];
}

/**
 *
 */
export function OrderbookMarketBuy(orderbook: Orderbook, offerAsset: Asset) {
	//we are buying the base asset
	let rest = +offerAsset.amount;
	let result = 0;
	let sellIndex = 0;
	while (rest > 0) {
		const currentSell = orderbook.sells[sellIndex];

		const currentOrderSize =
			currentSell.quantity * currentSell.price > rest ? rest : currentSell.quantity * currentSell.price;
		rest = rest - Math.floor(currentOrderSize);
		result = result + Math.floor(currentOrderSize / currentSell.price);
		sellIndex = sellIndex + 1;
	}
	return [result, orderbook.sells[sellIndex].price, +offerAsset.amount / result];
}

/**
 *
 */
export function getOrderbookMidPrice(orderbook: Orderbook) {
	return (
		Math.round(((orderbook.sells[0].price + orderbook.buys[0].price) / 2.0) * (1 / orderbook.minPriceIncrement)) /
		(1 / orderbook.minPriceIncrement)
	);
}

/**
 *
 */
export function getOrderbookSpread(orderbook: Orderbook, sellPosition = 0, buyPosition = 0) {
	return orderbook.sells[sellPosition].price - orderbook.buys[buyPosition].price;
}

/**
 *
 */
export function getOrderbookMaxPosition(orderbook: Orderbook, buy: boolean, priceThreshold: number) {
	if (buy) {
		const filteredBuys = orderbook.buys.filter((buy) => buy.price >= priceThreshold);
		const priceWall = filteredBuys
			.map((value, i) => [value.quantity * value.price, value.price])
			.reduce((r, a) => (a[0] > r[0] ? a : r))[1];
		return priceWall;
	} else {
		const filteredSells = orderbook.sells.filter((sell) => sell.price <= priceThreshold);
		const priceWall = filteredSells
			.map((value, i) => [value.quantity * value.price, value.price])
			.reduce((r, a) => (a[0] > r[0] ? a : r))[1];
		return priceWall;
	}
}
