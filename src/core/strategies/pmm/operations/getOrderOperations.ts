import { OrderSide, TradeDirection } from "@injectivelabs/ts-types";

import { getOrderbookMidPrice, Orderbook, PMMOrderbook } from "../../../types/base/orderbook";
import { priceBasedTradeDirection, validOpenOrder } from "./tradingRules";

export type OrderOperation = {
	price: string;
	quantity: number;
	marketid: string;
	orderSide: OrderSide;
};
export interface OrderbookOrderOperations {
	orderbook: Orderbook;
	ordersToCancelHashes: Array<string>;
	ordersToCreate: Array<OrderOperation>;
}

/**
 *
 */
export function getOrderOperations(pmmOrderbook: PMMOrderbook) {
	const shiftedMidPrice = getOrderbookMidPrice(pmmOrderbook) * pmmOrderbook.trading.config.priceMultiplier;
	const tradingParameters = pmmOrderbook.trading.config;

	const allowedTradeDirections = priceBasedTradeDirection(pmmOrderbook, shiftedMidPrice);
	pmmOrderbook.trading.allowedTradeDirections = allowedTradeDirections;
	const sellsToCancel: Array<string> = [];
	const buysToCancel: Array<string> = [];
	const ordersToCreate: Array<OrderOperation> = [];

	const buyPrice = Math.min(shiftedMidPrice * (1 - tradingParameters.bidSpread / 10000), pmmOrderbook.buys[0].price);
	const sellPrice = Math.max(
		shiftedMidPrice * (1 + tradingParameters.bidSpread / 10000),
		pmmOrderbook.sells[0].price,
	);

	for (const buyOrder of pmmOrderbook.trading.activeOrders.buys.values()) {
		if (!validOpenOrder(pmmOrderbook, buyOrder, shiftedMidPrice, allowedTradeDirections)) {
			buysToCancel.push(buyOrder.orderHash);
		}
	}

	for (const sellOrder of pmmOrderbook.trading.activeOrders.sells.values()) {
		if (!validOpenOrder(pmmOrderbook, sellOrder, shiftedMidPrice, allowedTradeDirections)) {
			sellsToCancel.push(sellOrder.orderHash);
		}
	}
	if (
		allowedTradeDirections.includes(TradeDirection.Buy) &&
		pmmOrderbook.trading.activeOrders.buys.size - buysToCancel.length < pmmOrderbook.trading.config.orderLevels
	) {
		ordersToCreate.push({
			price: String(buyPrice),
			quantity: tradingParameters.buyOrderAmount,
			marketid: pmmOrderbook.marketId,
			orderSide: OrderSide.Buy,
		});
	}
	if (
		allowedTradeDirections.includes(TradeDirection.Sell) &&
		pmmOrderbook.trading.activeOrders.sells.size - sellsToCancel.length < pmmOrderbook.trading.config.orderLevels
	) {
		ordersToCreate.push({
			price: String(sellPrice),
			quantity: tradingParameters.sellOrderAmount,
			marketid: pmmOrderbook.marketId,
			orderSide: OrderSide.Sell,
		});
	}

	return {
		ordersToCancel: [...buysToCancel, ...sellsToCancel],
		ordersToCreate: ordersToCreate,
	};
}
