import { RichAsset } from "./asset";
import { OrderbookPath, Path } from "./path";
export type Trade = OptimalTrade | OptimalOrderbookTrade;
export enum TradeType {
	ORDERBOOK = "ORDERBOOK", // an orderbook to orderbook trade
	AMM = "AMM", //an amm to amm trade
	COMBINED = "COMBINED", // combining amm and orderbook trade
}
export interface OptimalTrade {
	tradeType: TradeType;
	offerAsset: RichAsset;
	profit: number;
	path: Path;
}

export interface OptimalOrderbookTrade extends Omit<OptimalTrade, "path"> {
	worstPrice: number; //worst price for the market order to accept to fill the order
	averagePrice: number; //average price obtained by the order
	path: OrderbookPath;
	outGivenInOrderbook: number;
}
