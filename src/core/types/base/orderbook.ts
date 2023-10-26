import { Asset, NativeAssetInfo } from "./asset";

export interface Order {
	price: number;
	quantity: number;
	type: "sell" | "buy";
}
export interface Orderbook {
	marketId: string; //contractaddress or marketid
	baseAssetInfo: NativeAssetInfo;
	quoteAssetInfo: NativeAssetInfo;
	baseAssetDecimals: number;
	quoteAssetDecimals: number;
	minQuantityIncrement: number;
	buys: Array<Order>;
	sells: Array<Order>;
}

/**
 * Market sell the offered asset, meaning it should be matched to the buy side of the orderbook.
 * @param orderbook Orderbook type to sell on.
 * @param offerAsset Asset type to sell.
 * @return [number, number] the received asset amount and average price.
 */
export function OrderbookMarketSell(orderbook: Orderbook, offerAsset: Asset) {
	//we are selling the base asset
	let rest = Math.floor(+offerAsset.amount);
	let result = 0;
	let buyIndex = 0;
	while (rest > 0) {
		const currentBuy = orderbook.buys[buyIndex];
		const currentOrderSize = currentBuy.quantity > rest ? rest : currentBuy.quantity;
		rest = rest - Math.floor(currentOrderSize);
		result = result + Math.floor(currentOrderSize * currentBuy.price);
		buyIndex = buyIndex + 1;
	}
	return [Math.floor(0.998 * result), orderbook.buys[buyIndex].price, (0.998 * result) / +offerAsset.amount];
}

/**
 *
 */
export function OrderbookMarketBuy(orderbook: Orderbook, offerAsset: Asset) {
	//we are buying the base asset
	let rest = +offerAsset.amount;
	let result = 0;
	let sellIndex = 0;
	while (rest > 0) {
		const currentSell = orderbook.sells[sellIndex];

		const currentOrderSize =
			currentSell.quantity * currentSell.price > rest ? rest : currentSell.quantity * currentSell.price;
		rest = rest - Math.floor(currentOrderSize);
		result = result + Math.floor(currentOrderSize / currentSell.price);
		sellIndex = sellIndex + 1;
	}
	return [result, orderbook.sells[sellIndex].price, +offerAsset.amount / result];
}
