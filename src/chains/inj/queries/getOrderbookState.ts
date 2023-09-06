import { BigNumberInBase, BigNumberInWei } from "@injectivelabs/utils";

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
				const quantity = new BigNumberInWei(buy.quantity).toBase(decimalAdjustment);
				const price = new BigNumberInBase(buy.price).toWei(decimalAdjustment);
				const buyOrder: Order = {
					quantity: +quantity.toFixed(),
					price: +price.toFixed(),
					type: "buy",
				};
				orderbook.buys.push(buyOrder);
			}

			for (const sell of ob.sells) {
				const quantity = new BigNumberInWei(sell.quantity).toBase(decimalAdjustment);
				const price = new BigNumberInBase(sell.price).toWei(decimalAdjustment);
				const sellOrder: Order = {
					quantity: +quantity.toFixed(),
					price: +price.toFixed(),
					type: "sell",
				};
				orderbook.sells.push(sellOrder);
			}
		}),
	);
}
