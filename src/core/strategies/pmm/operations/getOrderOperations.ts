import { SpotLimitOrder, spotPriceToChainPriceToFixed } from "@injectivelabs/sdk-ts";
import { OrderSide } from "@injectivelabs/ts-types";

import { getOrderbookMidPrice, Orderbook, PMMOrderbook } from "../../../types/base/orderbook";

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
export function getOrderOperations(
	pmmOrderbook: PMMOrderbook,
	buys: Map<string, SpotLimitOrder> | undefined,
	sells: Map<string, SpotLimitOrder> | undefined,
) {
	const shiftedMidPrice = getOrderbookMidPrice(pmmOrderbook) * pmmOrderbook.trading.config.priceMultiplier;
	const tradingParameters = pmmOrderbook.trading.config;

	const ordersToCancel: Array<string> = [];
	const ordersToCreate: Array<OrderOperation> = [];
	if (buys) {
		for (const buyOrder of buys.values()) {
			if (
				+buyOrder.price <
					+spotPriceToChainPriceToFixed({
						value: shiftedMidPrice * (1 - tradingParameters.bidSpread / 10000),
						baseDecimals: pmmOrderbook.baseAssetDecimals,
						quoteDecimals: pmmOrderbook.quoteAssetDecimals,
					}) ||
				!buyAllowed(pmmOrderbook, shiftedMidPrice)
			) {
				ordersToCancel.push(buyOrder.orderHash);
				if (buyAllowed(pmmOrderbook, shiftedMidPrice)) {
					ordersToCreate.push({
						price: String(shiftedMidPrice * (1 - tradingParameters.bidSpread / 10000)),
						quantity: tradingParameters.buyOrderAmount,
						marketid: pmmOrderbook.marketId,
						orderSide: OrderSide.Buy,
					});
				}
			}
		}
	} else if (buyAllowed(pmmOrderbook, shiftedMidPrice)) {
		ordersToCreate.push({
			price: String(shiftedMidPrice * (1 - tradingParameters.bidSpread / 10000)),
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
					}) ||
				!sellAllowed(pmmOrderbook, shiftedMidPrice)
			) {
				ordersToCancel.push(sellOrder.orderHash);
				if (sellAllowed(pmmOrderbook, shiftedMidPrice)) {
					ordersToCreate.push({
						price: String(shiftedMidPrice * (1 + tradingParameters.bidSpread / 10000)),
						quantity: tradingParameters.sellOrderAmount,
						marketid: sellOrder.marketId,
						orderSide: sellOrder.orderSide,
					});
				}
			}
		}
	} else if (sellAllowed(pmmOrderbook, shiftedMidPrice)) {
		ordersToCreate.push({
			price: String(shiftedMidPrice * (1 + tradingParameters.bidSpread / 10000)),
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

/**
 *
 */
const buyAllowed = (orderbook: PMMOrderbook, price: number) => {
	return (
		(price < orderbook.trading.config.priceCeiling && orderbook.trading.buyAllowed === true) ||
		price < orderbook.trading.config.priceFloor
	);
};

/**
 *
 */
const sellAllowed = (orderbook: PMMOrderbook, price: number) => {
	return (
		(price > orderbook.trading.config.priceFloor && orderbook.trading.sellAllowed === true) ||
		price > orderbook.trading.config.priceCeiling
	);
};
