/*
	orderbook: Orderbook,
	price: number,
	quantity: number,
	injectiveAddress: string,
	offerAsset: Asset,
	orderType: OrderType,
    */

import { EncodeObject } from "@cosmjs/proto-signing";
import { MsgBatchUpdateOrders, OrderType, OrderTypeMap, spotPriceToChainPrice } from "@injectivelabs/sdk-ts";
import { OrderSide } from "@injectivelabs/ts-types";
import { BigNumberInBase } from "@injectivelabs/utils/dist/cjs/classes";

import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { OrderbookOrderOperations } from "../../../core/strategies/pmm/operations/getOrderOperations";

/**
 *
 */
export function getBatchUpdateOrdersMessage(
	chainOperator: ChainOperator,
	allOrderbookUpdates: Array<OrderbookOrderOperations>,
): [EncodeObject, number] {
	const subaccountId = chainOperator.client.subaccountId;
	const publicAddress = chainOperator.client.publicAddress;
	const spotOrdersToCancel: Array<{
		marketId: string;
		subaccountId: string;
		orderHash: string;
	}> = [];

	const spotOrdersToCreate: Array<{
		orderType: OrderType;
		triggerPrice?: string;
		marketId: string;
		feeRecipient: string;
		price: string;
		quantity: string;
	}> = [];

	for (const orderbookUpdate of allOrderbookUpdates) {
		if (orderbookUpdate.ordersToCancelHashes.length > 0) {
			orderbookUpdate.ordersToCancelHashes.forEach((slo) => {
				spotOrdersToCancel.push({
					marketId: orderbookUpdate.orderbook.marketId,
					subaccountId: subaccountId,
					orderHash: slo,
				});
			});
		}

		const decimalAdjustment =
			orderbookUpdate.orderbook.baseAssetDecimals - orderbookUpdate.orderbook.quoteAssetDecimals;

		if (orderbookUpdate.ordersToCreate.length > 0) {
			orderbookUpdate.ordersToCreate.forEach((order) => {
				const orderSize = +new BigNumberInBase(order.quantity).toWei(decimalAdjustment).toFixed();
				const beliefPriceOrderbook = spotPriceToChainPrice({
					value: +order.price,
					baseDecimals: orderbookUpdate.orderbook.baseAssetDecimals,
					quoteDecimals: orderbookUpdate.orderbook.quoteAssetDecimals,
				})
					.multipliedBy(1 / orderbookUpdate.orderbook.minPriceIncrement)
					.decimalPlaces(0)
					.dividedBy(1 / orderbookUpdate.orderbook.minPriceIncrement)
					.toFixed(15);
				spotOrdersToCreate.push({
					orderType: order.orderSide === OrderSide.Buy ? OrderTypeMap.BUY : OrderTypeMap.SELL,
					marketId: order.marketid,
					feeRecipient: chainOperator.client.publicAddress,
					price: beliefPriceOrderbook,
					quantity: String(orderSize),
				});
			});
		}
	}

	const msgBatchUpdateOrders = MsgBatchUpdateOrders.fromJSON({
		subaccountId: subaccountId,
		injectiveAddress: publicAddress,
		spotOrdersToCancel: spotOrdersToCancel,
		spotOrdersToCreate: spotOrdersToCreate,
	});

	return [
		{
			typeUrl: "/injective.exchange.v1beta1.MsgBatchUpdateOrders",
			value: msgBatchUpdateOrders,
		},
		spotOrdersToCancel.length + spotOrdersToCreate.length,
	];
}
