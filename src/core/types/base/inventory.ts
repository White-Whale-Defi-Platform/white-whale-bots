import { AccountPortfolioV2 as Inventory } from "@injectivelabs/sdk-ts";

import { getOrderbookMidPrice, PMMOrderbook } from "./orderbook";
export { AccountPortfolioV2 as Inventory } from "@injectivelabs/sdk-ts";

/**
 *
 */
export function netWorth(orderbooks: Array<PMMOrderbook>, inventory: Inventory) {
	let netWorth = 0; //in quote 6 decimal

	for (const ob of orderbooks) {
		const baseAssetInInventory = inventory.bankBalancesList
			.filter((coin) => coin.denom === ob.baseAssetInfo.native_token.denom)
			.map((coin) => +coin.amount)
			.reduce((a, b) => {
				return a + b;
			});
		const spotAmount = baseAssetInInventory / 10 ** (ob.baseAssetDecimals - ob.quoteAssetDecimals);
		netWorth += spotAmount * getOrderbookMidPrice(ob);
		ob.trading.activeOrders.buys.forEach((value, key) => {
			netWorth += +value.price * +value.quantity;
		});

		ob.trading.activeOrders.sells.forEach((value, key) => {
			netWorth += +value.price * +value.quantity;
		});
	}
	const uniqueQuoteDenoms = [
		...new Set(
			orderbooks.flatMap((ob) => {
				return ob.quoteAssetInfo.native_token.denom;
			}),
		),
	];
	for (const quotedDenom of uniqueQuoteDenoms) {
		const quoteAssetInInventory = inventory.bankBalancesList
			.filter((coin) => coin.denom === quotedDenom)
			.map((coin) => +coin.amount)
			.reduce((a, b) => {
				return a + b;
			});
		netWorth += quoteAssetInInventory;
	}
	console.log(netWorth);
	return netWorth;
}
/**
 *
 */
export function inventorySkew(inventory: Inventory, pmmOrderbook: PMMOrderbook) {
	const baseAssetInInventory = inventory.bankBalancesList
		.filter((coin) => coin.denom === pmmOrderbook.baseAssetInfo.native_token.denom)
		.map((coin) => +coin.amount)
		.reduce((a, b) => {
			return a + b;
		});

	const spotAmount = baseAssetInInventory / 10 ** (pmmOrderbook.baseAssetDecimals - pmmOrderbook.quoteAssetDecimals);
	const midPrice = getOrderbookMidPrice(pmmOrderbook);
	const skew = (spotAmount * midPrice) / pmmOrderbook.trading.assignedQuoteAmount;
	return skew;
}
