import { SpotLimitOrder } from "@injectivelabs/sdk-ts";
import { OrderSide } from "@injectivelabs/ts-types";
import { BigNumber } from "bignumber.js";

import { PMMConfig } from "../../../types/base/configs";
import { getOrderbookMidPrice, getOrderbookSpread, Orderbook } from "../../../types/base/orderbook";

export type OrderOperation = {
	price: string;
	quantity: number;
	marketid: string;
	orderSide: OrderSide;
};

/**
 *
 */
export function validateOrders(
	orderbook: Orderbook,
	botConfig: PMMConfig,
	buys: Map<string, SpotLimitOrder> | undefined,
	sells: Map<string, SpotLimitOrder> | undefined,
) {
	console.log(buys, sells);
	const midPrice = getOrderbookMidPrice(orderbook);
	const spread = getOrderbookSpread(orderbook);

	const ordersToCancel: Array<SpotLimitOrder> = [];
	const ordersToCreate: Array<OrderOperation> = [];
	if (buys) {
		for (const buyOrder of buys.values()) {
			if (+buyOrder.price < +midPrice - botConfig.bidSpread) {
				ordersToCancel.push(buyOrder);
				ordersToCreate.push({
					price: BigNumber(midPrice - botConfig.bidSpread).toFixed(3),
					quantity: botConfig.orderAmount,
					marketid: orderbook.marketId,
					orderSide: OrderSide.Buy,
				});
			}
		}
	} else {
		ordersToCreate.push({
			price: BigNumber(midPrice - botConfig.bidSpread).toFixed(3),
			quantity: botConfig.orderAmount,
			marketid: orderbook.marketId,
			orderSide: OrderSide.Buy,
		});
	}
	if (sells) {
		for (const sellOrder of sells.values()) {
			if (+sellOrder.price > +midPrice + botConfig.askSpread) {
				ordersToCancel.push(sellOrder);
				ordersToCreate.push({
					price: BigNumber(midPrice + botConfig.bidSpread).toFixed(3),
					quantity: botConfig.orderAmount,
					marketid: sellOrder.marketId,
					orderSide: sellOrder.orderSide,
				});
			}
		}
	} else {
		ordersToCreate.push({
			price: BigNumber(midPrice + botConfig.bidSpread).toFixed(3),
			quantity: botConfig.orderAmount,
			marketid: orderbook.marketId,
			orderSide: OrderSide.Sell,
		});
	}

	return {
		ordersToCancel: ordersToCancel.length === 0 ? undefined : ordersToCancel,
		ordersToCreate: ordersToCreate.length === 0 ? undefined : ordersToCreate,
	};
}
