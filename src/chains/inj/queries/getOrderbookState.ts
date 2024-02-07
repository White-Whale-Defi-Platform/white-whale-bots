import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { Order, Orderbook } from "../../../core/types/base/orderbook";

/**
 *
 */
export async function getOrderbookState(chainOperator: ChainOperator, orderbooks: Array<Orderbook>) {
	const obstates = await chainOperator.queryOrderbooks(orderbooks.map((orderbook) => orderbook.marketId));

	if (!obstates) {
		console.error("error querying orderbooks");
		return;
	}
	for (const i in orderbooks) {
		const ob = obstates[i];
		if (ob) {
			const orderbook = orderbooks[i];
			orderbook.buys = [];
			orderbook.sells = [];
			const decimalAdjustment: number = orderbook.baseAssetDecimals - orderbook.quoteAssetDecimals;

			for (const buy of ob.orderbook.buys) {
				const buyOrder: Order = {
					quantity: +buy.quantity / 10 ** decimalAdjustment,
					price: +buy.price * 10 ** decimalAdjustment,
					type: "buy",
				};
				orderbook.buys.push(buyOrder);
			}
			for (const sell of ob.orderbook.sells) {
				const sellOrder: Order = {
					quantity: +sell.quantity / 10 ** decimalAdjustment,
					price: +sell.price * 10 ** decimalAdjustment,
					type: "sell",
				};
				orderbook.sells.push(sellOrder);
			}
		}
	}
}
