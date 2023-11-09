import { getPoolStates } from "../../../../../chains/defaults";
import { messageFactory } from "../../../../../chains/defaults/messages/messageFactory";
import { getOrderbookState } from "../../../../../chains/inj";
import { ChainOperator } from "../../../../chainOperator/chainoperator";
import { Logger } from "../../../../logging";
import { DexConfig } from "../../../../types/base/configs";
import { OptimizerInterface } from "../../../../types/base/optimizers";
import { Orderbook } from "../../../../types/base/orderbook";
import { OrderbookPath, Path } from "../../../../types/base/path";
import { Pool } from "../../../../types/base/pool";
import { OptimalOrderbookTrade, OptimalTrade, Trade } from "../../../../types/base/trades";
/**
 *
 */
export interface DexLoopInterface {
	pools: Array<Pool>;
	orderbooks: Array<Orderbook>;
	paths: Array<Path>; //holds all known paths minus cooldowned paths
	orderbookPaths: Array<OrderbookPath>;
	CDpaths: Map<string, { timeoutIteration: number; timeoutDuration: number; path: OrderbookPath | Path }>; //holds all cooldowned paths' identifiers
	chainOperator: ChainOperator;
	accountNumber: number;
	sequence: number;
	botConfig: DexConfig;
	logger: Logger | undefined;
	iterations: number;

	/*
	 * Optimizers to use during loop runtime
	 */
	ammArb: OptimizerInterface<Path, OptimalTrade>; //Optimizer to calculate AMM arbitrage opportunities
	orderbookArb: OptimizerInterface<OrderbookPath, OptimalOrderbookTrade>; //Optimizer to calculate Orderbook <> AMM arbitrage opportunities

	/*
	 * State updaters to use during loop runtime
	 */
	updatePoolStates: typeof getPoolStates; //state updater for AMM pools
	updateOrderbookStates?: typeof getOrderbookState; //state updated for Orderbooks

	/*
	 * Message factories to translate `OptimalTrades` to Cosmos SDK messages
	 */
	messageFactory: typeof messageFactory; //factory to transform `OptimalTrades` into messages

	/*
	 * Additional required functions for DEX loops
	 */
	clearIgnoreAddresses: () => void; //delete timedout wallet addresses
	reset: () => Promise<void>; //reset all loop states
	step: () => Promise<void>; //iteration step to run continuously

	/*
	 * Trade Functions
	 */
	trade: (arbTrade: Trade) => void; //function to execute messages in a transaction on-chain
}
