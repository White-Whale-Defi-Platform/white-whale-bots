import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { Order, Orderbook } from "../../../core/types/base/orderbook";

/**
 *
 */
export async function getOrderbookState(chainOperator: ChainOperator, orderbooks: Array<Orderbook>) {
	await Promise.all(
		orderbooks.map(async (orderbook) => {
			const ob = await chainOperator.queryOrderbook(orderbook.marketId);
			if (!ob) {
				console.log("cannot fetch orderbook: ", orderbook.marketId);
				return;
			}
			orderbook.sells = [];
			orderbook.buys = [];
			const decimalAdjustment: number = orderbook.baseAssetDecimals - orderbook.quoteAssetDecimals;
			for (const buy of ob.buys) {
				const buyOrder: Order = {
					quantity: +buy.quantity / 10 ** decimalAdjustment,
					price: +buy.price * 10 ** decimalAdjustment,
					type: "buy",
				};
				orderbook.buys.push(buyOrder);
			}
			for (const sell of ob.sells) {
				const sellOrder: Order = {
					quantity: +sell.quantity / 10 ** decimalAdjustment,
					price: +sell.price * 10 ** decimalAdjustment,
					type: "sell",
				};
				orderbook.sells.push(sellOrder);
			}
		}),
	);
}
