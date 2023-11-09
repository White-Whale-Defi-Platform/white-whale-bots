import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { Orderbook } from "../../../core/types/base/orderbook";
/**
 *
 */
export async function getSubaccountOrders(chainOperator: ChainOperator, orderbook: Orderbook) {
	const orders = await chainOperator.queryOrderbookOrders(orderbook.marketId, chainOperator.client.subaccountId);
	if (orders) {
		return orders;
	}
}
