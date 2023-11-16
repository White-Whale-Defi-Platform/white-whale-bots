import { SpotLimitOrder, spotPriceToChainPriceToFixed } from "@injectivelabs/sdk-ts";
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
	const midPrice = getOrderbookMidPrice(orderbook);
	const spread = getOrderbookSpread(orderbook);

	const ordersToCancel: Array<SpotLimitOrder> = [];
	const ordersToCreate: Array<OrderOperation> = [];
	if (buys) {
		for (const buyOrder of buys.values()) {
			if (
				+buyOrder.price <
				+spotPriceToChainPriceToFixed({
					value: +midPrice * (1 - botConfig.bidSpread / 10000),
					baseDecimals: orderbook.baseAssetDecimals,
					quoteDecimals: orderbook.quoteAssetDecimals,
				})
			) {
				ordersToCancel.push(buyOrder);
				ordersToCreate.push({
					price: BigNumber(+midPrice * (1 - botConfig.bidSpread / 10000)).toFixed(3),
					quantity: botConfig.orderAmount,
					marketid: orderbook.marketId,
					orderSide: OrderSide.Buy,
				});
			}
		}
	} else {
		ordersToCreate.push({
			price: BigNumber(+midPrice * (1 - botConfig.bidSpread / 10000)).toFixed(3),
			quantity: botConfig.orderAmount,
			marketid: orderbook.marketId,
			orderSide: OrderSide.Buy,
		});
	}
	if (sells) {
		for (const sellOrder of sells.values()) {
			if (
				+sellOrder.price >
				+spotPriceToChainPriceToFixed({
					value: +midPrice * (1 + botConfig.bidSpread / 10000),
					baseDecimals: orderbook.baseAssetDecimals,
					quoteDecimals: orderbook.quoteAssetDecimals,
				})
			) {
				ordersToCancel.push(sellOrder);
				ordersToCreate.push({
					price: BigNumber(+midPrice * (1 + botConfig.askSpread / 10000)).toFixed(3),
					quantity: botConfig.orderAmount,
					marketid: sellOrder.marketId,
					orderSide: sellOrder.orderSide,
				});
			}
		}
	} else {
		ordersToCreate.push({
			price: BigNumber(+midPrice * (1 + botConfig.askSpread / 10000)).toFixed(3),
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
