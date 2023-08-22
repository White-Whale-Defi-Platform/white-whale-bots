import { messageFactory } from "../../../../chains/defaults/messages/messageFactory";
import { OptimalTrade } from "../../../arbitrage/arbitrage";
import { OptimalOrderbookTrade } from "../../../arbitrage/optimizers/orderbookOptimizer";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging";
import { DexConfig } from "../../base/configs";
import { Orderbook } from "../../base/orderbook";
import { OrderbookPath, Path } from "../../base/path";
import { Pool } from "../../base/pool";
/**
 *
 */
export interface DexLoopInterface {
	pools: Array<Pool>;
	orderbooks: Array<Orderbook>;
	paths: Array<Path>; //holds all known paths minus cooldowned paths
	orderbookPaths: Array<OrderbookPath>;
	pathlib: Array<Path>; //holds all known paths
	CDpaths: Map<string, [number, number, number]>; //holds all cooldowned paths' identifiers
	chainOperator: ChainOperator;
	accountNumber: number;
	sequence: number;
	botConfig: DexConfig;
	logger: Logger | undefined;
	iterations: number;

	/**
	 *
	 */
	ammArb: (paths: Array<Path>, botConfig: DexConfig) => OptimalTrade | undefined;
	orderbookArb: (paths: Array<OrderbookPath>, botConfig: DexConfig) => OptimalOrderbookTrade | undefined;
	updatePoolStates: (chainOperator: ChainOperator, pools: Array<Pool>) => Promise<void>;
	updateOrderbookStates?: (chainOperator: ChainOperator, orderbooks: Array<Orderbook>) => Promise<void>;
	messageFactory: typeof messageFactory;
	step: () => Promise<void>;
	reset: () => Promise<void>;
	clearIgnoreAddresses: () => void;
}
