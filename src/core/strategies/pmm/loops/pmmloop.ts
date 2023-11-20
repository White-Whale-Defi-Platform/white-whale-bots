import { StdFee } from "@cosmjs/stargate";
import { SpotLimitOrder, SpotTrade } from "@injectivelabs/sdk-ts";
import { OrderSide } from "@injectivelabs/ts-types";

import * as chains from "../../../../chains";
import { initOrderbooks } from "../../../../chains/inj";
import { getBatchUpdateOrdersMessage } from "../../../../chains/inj/messages/getBatchUpdateOrdersMessage";
import { getSubaccountOrders } from "../../../../chains/inj/queries/getOrderbookOrders";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { PMMConfig } from "../../../types/base/configs";
import { Orderbook } from "../../../types/base/orderbook";
import { fetchPMMParameters } from "../operations/marketAnalysis";
import Scheduler from "../operations/scheduling";
import { calculatePortfolioValue, calculateTradeHistoryProfit } from "../operations/tradeHistoryProfit";
import { validateOrders } from "../operations/validateOrders";

/**
 *
 */
export class PMMLoop {
	orderbooks: Array<Orderbook>;
	logger: Logger | undefined;
	chainOperator: ChainOperator;
	botConfig: PMMConfig;
	startTimestamp = Date.now();
	activeOrders: { buys: Map<string, SpotLimitOrder>; sells: Map<string, SpotLimitOrder> } = {
		buys: new Map(),
		sells: new Map(),
	};
	tradeHistory: {
		summary: { startingValueInQuote: number; currentValueInQuote: number; grossGainInQuote: number };
		trades: Array<SpotTrade>;
	};
	scheduler: Scheduler;
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
		this.scheduler = new Scheduler();
		this.tradeHistory = {
			summary: { startingValueInQuote: 0, currentValueInQuote: 0, grossGainInQuote: 0 },
			trades: [],
		};
		if (this.logger) {
			this.scheduler.addListener("logTrigger", this.logger.loopLogging.logPMMLoop);
		}
		this.scheduler.addListener("updateOrders", this.executeOrderOperations);
	}

	/**
	 *
	 */
	public async step() {
		while (true) {
			const checkTradeUpdates = await this.setMyOrders();
			if (checkTradeUpdates) {
				await this.setMyTrades();
			}
			await this.updateOrderbookStates(this.chainOperator, this.orderbooks);
		}
		/*

		*/
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
	executeOrderOperations = async (time?: Date) => {
		const { ordersToCancel, ordersToCreate } = validateOrders(
			this.orderbooks[0],
			this.botConfig,
			this.activeOrders.buys.size === 0 ? undefined : this.activeOrders.buys,
			this.activeOrders.sells.size === 0 ? undefined : this.activeOrders.sells,
		);
		if (ordersToCancel || ordersToCreate) {
			const [msgBatchUpdateOrders, nrOfOperations] = getBatchUpdateOrdersMessage(
				this.chainOperator,
				this.orderbooks[0],
				ordersToCancel,
				ordersToCreate,
			);
			if (nrOfOperations > 2) {
				const decimalCompensator = this.botConfig.gasDenom === "inj" ? 1e12 : 1;
				const gasFee = {
					denom: this.botConfig.gasDenom,
					amount: (250000 * this.botConfig.gasPrice * decimalCompensator).toFixed(),
				};
				const fee: StdFee = { amount: [gasFee], gas: String(250000) };
				const txRes = await this.chainOperator.signAndBroadcast([msgBatchUpdateOrders], fee);
			} else {
				const txRes = await this.chainOperator.signAndBroadcast([msgBatchUpdateOrders]);
			}
			await this.logger?.tradeLogging.logOrderbookPositionUpdate(this, ordersToCancel, ordersToCreate);
		}
		if (ordersToCancel) {
			for (const orderToCancel of ordersToCancel) {
				this.activeOrders.buys.delete(orderToCancel.orderHash);
				this.activeOrders.sells.delete(orderToCancel.orderHash);
			}
		}
	};
	/**
	 *
	 */
	setMyOrders = async () => {
		// this.myOrders = { buys: new Map(), sells: new Map() };
		const activeOrders = await getSubaccountOrders(this.chainOperator, this.orderbooks[0]);
		let checkTradeUpdates = false;
		if (activeOrders) {
			const myOrdersHashes = activeOrders.orders.map((order) => order.orderHash);
			for (const buyOrderHash of this.activeOrders.buys.keys()) {
				if (!myOrdersHashes.includes(buyOrderHash)) {
					this.activeOrders.buys.delete(buyOrderHash);
					checkTradeUpdates = true;
				}
			}
			for (const sellOrderHash of this.activeOrders.sells.keys()) {
				if (!myOrdersHashes.includes(sellOrderHash)) {
					this.activeOrders.sells.delete(sellOrderHash);
					checkTradeUpdates = true;
				}
			}

			for (const myOrder of activeOrders.orders) {
				if (!this.activeOrders.buys.has(myOrder.orderHash) && !this.activeOrders.sells.has(myOrder.orderHash)) {
					// new order
					checkTradeUpdates = true;
				}
				if (myOrder.orderSide === OrderSide.Buy) {
					this.activeOrders.buys.set(myOrder.orderHash, myOrder);
				} else if (myOrder.orderSide === OrderSide.Sell) {
					this.activeOrders.sells.set(myOrder.orderHash, myOrder);
				}
			}
		}
		return checkTradeUpdates;
	};

	/**
	 *
	 */
	setMyTrades = async () => {
		const tradeHistory = await this.chainOperator.client.queryOrderbookTrades(
			this.orderbooks[0].marketId,
			this.chainOperator.client.subaccountId,
			this.startTimestamp,
		);
		if (tradeHistory) {
			this.tradeHistory.trades = tradeHistory.trades;
			this.tradeHistory.summary.grossGainInQuote = calculateTradeHistoryProfit(
				this.orderbooks[0],
				tradeHistory.trades,
			);
		}

		const portfolio = await this.chainOperator.queryAccountPortfolio();

		if (portfolio) {
			this.tradeHistory.summary.currentValueInQuote = calculatePortfolioValue(this.orderbooks[0], portfolio);
		}
		await this.logger?.loopLogging.logPMMLoop(this, new Date());
	};

	/**
	 *
	 */
	public async reset() {
		await this.setMyOrders();
		await this.setMyTrades();
		//do something later
	}

	/**
	 *
	 */
	public async init() {
		const [bidspread, askspread] = await fetchPMMParameters(this.orderbooks[0], "15", "48");
		(this.botConfig.bidSpread = bidspread), (this.botConfig.askSpread = askspread);

		await this.setMyOrders();
		await this.executeOrderOperations();
		this.scheduler.startOrderUpdates(this.botConfig.orderRefreshTime * 1000);
		this.scheduler.startLogTimer(this.botConfig.signOfLife * 60 * 1000, this);
		const portfolio = await this.chainOperator.queryAccountPortfolio();

		if (portfolio) {
			this.tradeHistory.summary.startingValueInQuote = calculatePortfolioValue(this.orderbooks[0], portfolio);
		}
		await delay(1000);
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
		await loop.init();
		return loop;
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
