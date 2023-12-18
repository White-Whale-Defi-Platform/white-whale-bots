import { getOrderbookMidPrice, getOrderbookSpread, PMMOrderbook } from "../../../types/base/orderbook";
import getMarketTA from "./marketTA";
/**
 *
 */
export async function setPMMParameters(orderbook: PMMOrderbook, resolution: string, countback = "14") {
	const { rsi, natr } = await getMarketTA(orderbook, resolution, countback);
	const midprice = getOrderbookMidPrice(orderbook);
	const biDirectionalSpread = Math.min((getOrderbookSpread(orderbook, 5, 5) / midprice / 2) * 10000, 250);
	// const spreadMultiplier = natr / averageWeightedWidth;
	const rsiNormalised = ((50 - rsi) / 50) * natr;
	const skewNormalised = (50 - Math.max(Math.min(orderbook.trading.inventorySkew, 100), 0)) / 50;
	const priceMultiplier = ((rsiNormalised + skewNormalised) / 2) * natr;
	console.log(
		`updating parameters for ${orderbook.ticker}: bid ${orderbook.trading.config.bidSpread} --> ${biDirectionalSpread}, ask ${orderbook.trading.config.askSpread} --> ${biDirectionalSpread}`,
		`\nprice multiplier with RSI ${rsi} and Inventory Skew ${
			orderbook.trading.inventorySkew
		}: ${priceMultiplier}, shifts price from ${midprice} to ${(1 + priceMultiplier) * midprice}`,
	);
	orderbook.trading.config.askSpread = biDirectionalSpread;
	orderbook.trading.config.bidSpread = biDirectionalSpread;
	orderbook.trading.config.priceMultiplier = 1 + priceMultiplier;
}
