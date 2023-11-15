/*
	orderbook: Orderbook,
	price: number,
	quantity: number,
	injectiveAddress: string,
	offerAsset: Asset,
	orderType: OrderType,
    */

import {
	MsgBatchUpdateOrders,
	OrderType,
	OrderTypeMap,
	SpotLimitOrder,
	spotPriceToChainPriceToFixed,
} from "@injectivelabs/sdk-ts";
import { OrderSide } from "@injectivelabs/ts-types";
import { BigNumberInBase } from "@injectivelabs/utils/dist/cjs/classes";

import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { OrderOperation } from "../../../core/strategies/pmm/operations/validateOrders";
import { Orderbook } from "../../../core/types/base/orderbook";

/**
 *
 */
export function getBatchUpdateOrdersMessage(
	chainOperator: ChainOperator,
	orderbook: Orderbook,
	ordersToCancel: Array<SpotLimitOrder> | undefined,
	ordersToCreate: Array<OrderOperation> | undefined,
) {
	const subaccountId = chainOperator.client.subaccountId;
	const publicAddress = chainOperator.client.publicAddress;
	const spotOrdersToCancel: Array<{
		marketId: string;
		subaccountId: string;
		orderHash: string;
	}> = [];
	if (ordersToCancel) {
		ordersToCancel.forEach((slo) => {
			spotOrdersToCancel.push({
				marketId: orderbook.marketId,
				subaccountId: subaccountId,
				orderHash: slo.orderHash,
			});
		});
	}

	const spotOrdersToCreate: Array<{
		orderType: OrderType;
		triggerPrice?: string;
		marketId: string;
		feeRecipient: string;
		price: string;
		quantity: string;
	}> = [];

	const decimalAdjustment = orderbook.baseAssetDecimals - orderbook.quoteAssetDecimals;

	if (ordersToCreate) {
		ordersToCreate.forEach((order) => {
			const orderSize = +new BigNumberInBase(order.quantity).toWei(decimalAdjustment).toFixed();
			const beliefPriceOrderbook = spotPriceToChainPriceToFixed({
				value: order.price,
				baseDecimals: orderbook.baseAssetDecimals,
				quoteDecimals: orderbook.quoteAssetDecimals,
				decimalPlaces: 3,
			});
			spotOrdersToCreate.push({
				orderType: order.orderSide === OrderSide.Buy ? OrderTypeMap.BUY : OrderTypeMap.SELL,
				marketId: order.marketid,
				feeRecipient: chainOperator.client.publicAddress,
				price: String(beliefPriceOrderbook),
				quantity: String(orderSize),
			});
		});
	}

	const msgBatchUpdateOrders = MsgBatchUpdateOrders.fromJSON({
		subaccountId: subaccountId,
		injectiveAddress: publicAddress,
		spotOrdersToCancel: spotOrdersToCancel,
		spotOrdersToCreate: spotOrdersToCreate,
	});

	return {
		typeUrl: "/injective.exchange.v1beta1.MsgBatchUpdateOrders",
		value: msgBatchUpdateOrders,
	};
}
