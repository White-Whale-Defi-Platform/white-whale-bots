import { SpotLimitOrder, spotPriceToChainPriceToFixed } from "@injectivelabs/sdk-ts";
import { OrderSide } from "@injectivelabs/ts-types";
import { BigNumber } from "bignumber.js";

import { getOrderbookMidPrice, getOrderbookSpread, PMMOrderbook } from "../../../types/base/orderbook";

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
	pmmOrderbook: PMMOrderbook,
	buys: Map<string, SpotLimitOrder> | undefined,
	sells: Map<string, SpotLimitOrder> | undefined,
) {
	const midPrice = getOrderbookMidPrice(pmmOrderbook);
	const spread = getOrderbookSpread(pmmOrderbook);
	const tradingParameters = pmmOrderbook.trading.config;

	const ordersToCancel: Array<SpotLimitOrder> = [];
	const ordersToCreate: Array<OrderOperation> = [];
	if (buys) {
		for (const buyOrder of buys.values()) {
			if (
				+buyOrder.price <
				+spotPriceToChainPriceToFixed({
					value: +midPrice * (1 - tradingParameters.bidSpread / 10000),
					baseDecimals: pmmOrderbook.baseAssetDecimals,
					quoteDecimals: pmmOrderbook.quoteAssetDecimals,
				})
			) {
				ordersToCancel.push(buyOrder);
				ordersToCreate.push({
					price: BigNumber(+midPrice * (1 - tradingParameters.bidSpread / 10000)).toFixed(3),
					quantity: tradingParameters.orderAmount,
					marketid: pmmOrderbook.marketId,
					orderSide: OrderSide.Buy,
				});
			}
		}
	} else {
		ordersToCreate.push({
			price: BigNumber(+midPrice * (1 - tradingParameters.bidSpread / 10000)).toFixed(3),
			quantity: tradingParameters.orderAmount,
			marketid: pmmOrderbook.marketId,
			orderSide: OrderSide.Buy,
		});
	}
	if (sells) {
		for (const sellOrder of sells.values()) {
			if (
				+sellOrder.price >
				+spotPriceToChainPriceToFixed({
					value: +midPrice * (1 + tradingParameters.bidSpread / 10000),
					baseDecimals: pmmOrderbook.baseAssetDecimals,
					quoteDecimals: pmmOrderbook.quoteAssetDecimals,
				})
			) {
				ordersToCancel.push(sellOrder);
				ordersToCreate.push({
					price: BigNumber(+midPrice * (1 + tradingParameters.askSpread / 10000)).toFixed(3),
					quantity: tradingParameters.orderAmount,
					marketid: sellOrder.marketId,
					orderSide: sellOrder.orderSide,
				});
			}
		}
	} else {
		ordersToCreate.push({
			price: BigNumber(+midPrice * (1 + tradingParameters.askSpread / 10000)).toFixed(3),
			quantity: tradingParameters.orderAmount,
			marketid: pmmOrderbook.marketId,
			orderSide: OrderSide.Sell,
		});
	}

	return {
		ordersToCancel: ordersToCancel.length === 0 ? undefined : ordersToCancel,
		ordersToCreate: ordersToCreate.length === 0 ? undefined : ordersToCreate,
	};
}
