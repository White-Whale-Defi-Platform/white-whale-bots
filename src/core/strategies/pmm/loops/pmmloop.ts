import { SpotLimitOrder } from "@injectivelabs/sdk-ts";
import { OrderSide } from "@injectivelabs/ts-types";
import { inspect } from "util";

import * as chains from "../../../../chains";
import { initOrderbooks } from "../../../../chains/inj";
import { getBatchUpdateOrdersMessage } from "../../../../chains/inj/messages/getBatchUpdateOrdersMessage";
import { getSubaccountOrders } from "../../../../chains/inj/queries/getOrderbookOrders";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { PMMConfig } from "../../../types/base/configs";
import { getOrderbookMidPrice, getOrderbookSpread, Orderbook } from "../../../types/base/orderbook";
import { validateOrders } from "../operations/validateOrders";

/**
 *
 */
export class PMMLoop {
	orderbooks: Array<Orderbook>;
	logger: Logger | undefined;
	chainOperator: ChainOperator;
	botConfig: PMMConfig;
	iterations = 0;
	myOrders: { buys: Map<string, SpotLimitOrder>; sells: Map<string, SpotLimitOrder> } = {
		buys: new Map(),
		sells: new Map(),
	};
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
		await this.updateOrderbookStates(this.chainOperator, this.orderbooks);
		const spread = getOrderbookSpread(this.orderbooks[0]);
		const midPrice = getOrderbookMidPrice(this.orderbooks[0]);

		const { ordersToCancel, ordersToCreate } = validateOrders(
			this.orderbooks[0],
			this.botConfig,
			this.myOrders.buys.size === 0 ? undefined : this.myOrders.buys,
			this.myOrders.sells.size === 0 ? undefined : this.myOrders.sells,
		);
		console.log(ordersToCancel, ordersToCreate);
		if (ordersToCancel || ordersToCreate) {
			const msgBatchUpdateOrders = getBatchUpdateOrdersMessage(
				this.chainOperator,
				this.orderbooks[0],
				ordersToCancel,
				ordersToCreate,
			);

			const txRes = await this.chainOperator.signAndBroadcast([msgBatchUpdateOrders]);
			console.log(inspect(txRes.transactionHash, true, null, true));
		}

		await delay(5 * 60 * 1000);
	}
	/**
	 *
	 */
	public clearIgnoreAddresses() {
		return;
	}

	/**
	 *
	 */
	private async setMyOrders() {
		this.myOrders = { buys: new Map(), sells: new Map() };
		const myOrders = await getSubaccountOrders(this.chainOperator, this.orderbooks[0]);
		if (myOrders) {
			for (const myOrder of myOrders.orders) {
				if (myOrder.orderSide === OrderSide.Buy) {
					this.myOrders.buys.set(myOrder.orderHash, myOrder);
				} else if (myOrder.orderSide === OrderSide.Sell) {
					this.myOrders.sells.set(myOrder.orderHash, myOrder);
				}
			}
		}
	}
	/**
	 *
	 */
	public async reset() {
		await this.setMyOrders();
		//do something later
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

		const loop = new PMMLoop(chainOperator, botConfig, logger, orderbooks, getOrderbookState);
		await loop.setMyOrders();
		return loop;
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
