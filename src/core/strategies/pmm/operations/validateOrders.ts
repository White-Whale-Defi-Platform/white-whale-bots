import { SpotLimitOrder, spotPriceToChainPriceToFixed } from "@injectivelabs/sdk-ts";
import { OrderSide } from "@injectivelabs/ts-types";
import { BigNumber } from "bignumber.js";

import { getOrderbookMaxPosition, getOrderbookMidPrice, PMMOrderbook } from "../../../types/base/orderbook";

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
	const shiftedMidPrice = getOrderbookMidPrice(pmmOrderbook) * pmmOrderbook.trading.config.priceMultiplier;
	const tradingParameters = pmmOrderbook.trading.config;

	const ordersToCancel: Array<SpotLimitOrder> = [];
	const ordersToCreate: Array<OrderOperation> = [];
	const midprice = getOrderbookMidPrice(pmmOrderbook);

	const biggestSellPrice = BigNumber(
		getOrderbookMaxPosition(pmmOrderbook, false, midprice * 1.05) - pmmOrderbook.minPriceIncrement,
	).toFixed(5);
	const biggestBuyPrice = BigNumber(
		getOrderbookMaxPosition(pmmOrderbook, true, midprice * 0.95) + pmmOrderbook.minPriceIncrement,
	).toFixed(5);
	if (buys) {
		for (const buyOrder of buys.values()) {
			if (
				+buyOrder.price <
				+spotPriceToChainPriceToFixed({
					value: shiftedMidPrice * (1 - tradingParameters.bidSpread / 10000),
					baseDecimals: pmmOrderbook.baseAssetDecimals,
					quoteDecimals: pmmOrderbook.quoteAssetDecimals,
				})
			) {
				ordersToCancel.push(buyOrder);
				ordersToCreate.push({
					price: String(biggestBuyPrice),
					quantity: tradingParameters.buyOrderAmount,
					marketid: pmmOrderbook.marketId,
					orderSide: OrderSide.Buy,
				});
			}
		}
	} else {
		ordersToCreate.push({
			price: String(biggestBuyPrice),
			quantity: tradingParameters.buyOrderAmount,
			marketid: pmmOrderbook.marketId,
			orderSide: OrderSide.Buy,
		});
	}
	if (sells) {
		for (const sellOrder of sells.values()) {
			if (
				+sellOrder.price >
				+spotPriceToChainPriceToFixed({
					value: shiftedMidPrice * (1 + tradingParameters.bidSpread / 10000),
					baseDecimals: pmmOrderbook.baseAssetDecimals,
					quoteDecimals: pmmOrderbook.quoteAssetDecimals,
				})
			) {
				ordersToCancel.push(sellOrder);
				ordersToCreate.push({
					price: String(biggestSellPrice),
					quantity: tradingParameters.sellOrderAmount,
					marketid: sellOrder.marketId,
					orderSide: sellOrder.orderSide,
				});
			}
		}
	} else {
		ordersToCreate.push({
			price: String(biggestSellPrice),
			quantity: tradingParameters.sellOrderAmount,
			marketid: pmmOrderbook.marketId,
			orderSide: OrderSide.Sell,
		});
	}

	return {
		ordersToCancel: ordersToCancel.length === 0 ? undefined : ordersToCancel,
		ordersToCreate: ordersToCreate.length === 0 ? undefined : ordersToCreate,
	};
}
