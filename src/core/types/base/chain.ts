import { ChainOperator } from "../../chainOperator/chainoperator";
import { DexLoopInterface } from "../arbitrageloops/interfaces/dexloopInterface";
import { ChainConfig } from "./configs";
import { Orderbook } from "./orderbook";
import { Pool } from "./pool";

export interface Chain {
	chainConfig: ChainConfig;
	pools: Array<Pool>;
	chainOperator: ChainOperator;
	orderbooks: Array<Orderbook>;
	updatePoolStates: DexLoopInterface["updatePoolStates"];
	updateOrderbookStates?: DexLoopInterface["updateOrderbookStates"];
}
