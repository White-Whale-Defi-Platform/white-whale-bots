import { MsgBatchCancelSpotOrders, SpotLimitOrder } from "@injectivelabs/sdk-ts";

import { ChainOperator } from "../../../core/chainOperator/chainoperator";

/**
 *InjectiveAddress: string;
        orders: {
            marketId: string;
            subaccountId: string;
            orderHash: string;
            orderMask?: InjectiveExchangeV1Beta1Exchange.OrderMask;
        }[];
    }.
 */
export function getBatchCancelOrdersMessage(chainOperator: ChainOperator, ordersToCancel: Array<SpotLimitOrder>) {
	const msgBatchUpdateOrders = MsgBatchCancelSpotOrders.fromJSON({
		injectiveAddress: chainOperator.client.publicAddress,
		orders: ordersToCancel.map((orderToCancel) => {
			return {
				marketId: orderToCancel.marketId,
				subaccountId: chainOperator.client.subaccountId,
				orderHash: orderToCancel.orderHash,
			};
		}),
	});

	return {
		typeUrl: "/injective.exchange.v1beta1.MsgBatchUpdateOrders",
		value: msgBatchUpdateOrders,
	};
}
