import { getPoolStates } from "../../../../chains/defaults";
import { messageFactory } from "../../../../chains/defaults/messages/messageFactory";
import { getOrderbookState } from "../../../../chains/inj";
import { OptimalTrade, tryAmmArb, tryOrderbookArb } from "../../../arbitrage/arbitrage";
import { OptimalOrderbookTrade } from "../../../arbitrage/optimizers/orderbookOptimizer";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging";
import { BotConfig } from "../../base/configs";
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
	botConfig: BotConfig;
	logger: Logger | undefined;
	iterations: number;

	/*
	 * Optimizers to use during loop runtime
	 */
	ammArb: typeof tryAmmArb | undefined; //Optimizer to calculate AMM arbitrage opportunities
	orderbookArb: typeof tryOrderbookArb | undefined; //Optimizer to calculate Orderbook <> AMM arbitrage opportunities

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
	trade: (arbTrade: OptimalTrade | undefined, arbTradeOB: OptimalOrderbookTrade | undefined) => void; //function to execute messages in a transaction on-chain
}
