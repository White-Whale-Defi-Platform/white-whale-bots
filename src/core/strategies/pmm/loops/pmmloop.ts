import * as chains from "../../../../chains";
import { initOrderbooks } from "../../../../chains/inj";
import { getSubaccountOrders } from "../../../../chains/inj/queries/getOrderbookOrders";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { PMMConfig } from "../../../types/base/configs";
import { Orderbook } from "../../../types/base/orderbook";

/**
 *
 */
export class PMMLoop {
	orderbooks: Array<Orderbook>;
	logger: Logger | undefined;
	chainOperator: ChainOperator;
	botConfig: PMMConfig;
	iterations = 0;
	updateOrderbookStates: (chainOperator: ChainOperator, orderbooks: Array<Orderbook>) => Promise<void>;

	/**
	 *
	 */
	public constructor(
		chainOperator: ChainOperator,
		botConfig: PMMConfig,
		logger: Logger | undefined,
		orderbooks: Array<Orderbook>,
		updateOrderbookStates: (chainOperator: ChainOperator, orderbooks: Array<Orderbook>) => Promise<void>,
	) {
		(this.chainOperator = chainOperator),
			(this.botConfig = botConfig),
			(this.orderbooks = orderbooks),
			(this.logger = logger),
			(this.updateOrderbookStates = updateOrderbookStates);
	}

	/**
	 *
	 */
	public async step() {
		const myOrders = getSubaccountOrders(this.chainOperator, this.orderbooks[0]);
		console.log(myOrders);
	}

	/**
	 *
	 */
	static async createLoop(chainOperator: ChainOperator, botConfig: PMMConfig, logger: Logger) {
		const obs = await initOrderbooks(chainOperator, botConfig);
		const orderbooks: Array<Orderbook> = [];
		if (obs) {
			orderbooks.push(...obs);
		}
		const getOrderbookState = chains.injective.getOrderbookState;
		return new PMMLoop(chainOperator, botConfig, logger, orderbooks, getOrderbookState);
	}
}
