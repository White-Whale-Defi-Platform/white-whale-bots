import { StdFee } from "@cosmjs/stargate";
import { SpotLimitOrder } from "@injectivelabs/sdk-ts";
import { OrderSide } from "@injectivelabs/ts-types";

import * as chains from "../../../../chains";
import { initOrderbooks } from "../../../../chains/inj";
import { getBatchUpdateOrdersMessage } from "../../../../chains/inj/messages/getBatchUpdateOrdersMessage";
import { getSubaccountOrders } from "../../../../chains/inj/queries/getOrderbookOrders";
import { initPMMOrderbooks } from "../../../../chains/inj/queries/initOrderbook";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { PMMConfig } from "../../../types/base/configs";
import { Orderbook, PMMOrderbook } from "../../../types/base/orderbook";
import Scheduler from "../operations/scheduling";
import { calculateTradeHistoryProfit } from "../operations/tradeHistoryProfit";
import { OrderOperation, validateOrders } from "../operations/validateOrders";

/**
 *
 */
export class PMMLoop {
	PMMOrderbooks: Array<PMMOrderbook>;
	logger: Logger | undefined;
	chainOperator: ChainOperator;
	botConfig: PMMConfig;
	startTimestamp = Date.now();

	scheduler: Scheduler;
	updateOrderbookStates: (chainOperator: ChainOperator, orderbooks: Array<Orderbook>) => Promise<void>;

	/**
	 *
	 */
	public constructor(
		chainOperator: ChainOperator,
		botConfig: PMMConfig,
		logger: Logger | undefined,
		pmmOrderbooks: Array<PMMOrderbook>,
		updateOrderbookStates: (chainOperator: ChainOperator, orderbooks: Array<Orderbook>) => Promise<void>,
	) {
		(this.chainOperator = chainOperator),
			(this.botConfig = botConfig),
			(this.PMMOrderbooks = pmmOrderbooks),
			(this.logger = logger),
			(this.updateOrderbookStates = updateOrderbookStates);
		this.scheduler = new Scheduler();

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
			await this.updateOrderbookStates(this.chainOperator, this.PMMOrderbooks);
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
		const allOrderbookUpdates: Array<{
			orderbook: Orderbook;
			ordersToCancel: Array<SpotLimitOrder>;
			ordersToCreate: Array<OrderOperation>;
		}> = [];
		this.PMMOrderbooks.forEach((pmmOrderbook) => {
			const { ordersToCancel, ordersToCreate } = validateOrders(
				pmmOrderbook,
				pmmOrderbook.trading.activeOrders.buys.size === 0 ? undefined : pmmOrderbook.trading.activeOrders.buys,
				pmmOrderbook.trading.activeOrders.sells.size === 0
					? undefined
					: pmmOrderbook.trading.activeOrders.sells,
			);
			if (ordersToCancel || ordersToCreate) {
				allOrderbookUpdates.push({
					orderbook: pmmOrderbook,
					ordersToCancel: ordersToCancel ?? [],
					ordersToCreate: ordersToCreate ?? [],
				});
			}
			if (ordersToCancel) {
				for (const orderToCancel of ordersToCancel) {
					pmmOrderbook.trading.activeOrders.buys.delete(orderToCancel.orderHash);
					pmmOrderbook.trading.activeOrders.sells.delete(orderToCancel.orderHash);
				}
			}
		});

		if (allOrderbookUpdates.length > 0) {
			const [msgBatchUpdateOrders, nrOfOperations] = getBatchUpdateOrdersMessage(
				this.chainOperator,
				allOrderbookUpdates,
			);
			if (nrOfOperations > 2) {
				const decimalCompensator = this.botConfig.gasDenom === "inj" ? 1e12 : 1;
				const gasFee = {
					denom: this.botConfig.gasDenom,
					amount: (250000 * this.botConfig.gasPrice * decimalCompensator).toFixed(),
				};
				const fee: StdFee = { amount: [gasFee], gas: String(250000) };
				const txRes = await this.chainOperator.signAndBroadcast([msgBatchUpdateOrders], fee);
				console.log(txRes);
			} else {
				const txRes = await this.chainOperator.signAndBroadcast([msgBatchUpdateOrders]);
				console.log(txRes);
			}
			await this.logger?.tradeLogging.logOrderbookPositionUpdate(allOrderbookUpdates);
		}
	};
	/**
	 *
	 */
	setMyOrders = async () => {
		// this.myOrders = { buys: new Map(), sells: new Map() };
		let checkTradeUpdates = false;
		await Promise.all(
			this.PMMOrderbooks.map(async (pmmOrderbook) => {
				const activeOrders = await getSubaccountOrders(this.chainOperator, pmmOrderbook);

				if (activeOrders) {
					const myOrdersHashes = activeOrders.orders.map((order) => order.orderHash);
					for (const buyOrderHash of pmmOrderbook.trading.activeOrders.buys.keys()) {
						if (!myOrdersHashes.includes(buyOrderHash)) {
							pmmOrderbook.trading.activeOrders.buys.delete(buyOrderHash);
							checkTradeUpdates = true;
						}
					}
					for (const sellOrderHash of pmmOrderbook.trading.activeOrders.sells.keys()) {
						if (!myOrdersHashes.includes(sellOrderHash)) {
							pmmOrderbook.trading.activeOrders.sells.delete(sellOrderHash);
							checkTradeUpdates = true;
						}
					}

					for (const myOrder of activeOrders.orders) {
						if (
							!pmmOrderbook.trading.activeOrders.buys.has(myOrder.orderHash) &&
							!pmmOrderbook.trading.activeOrders.sells.has(myOrder.orderHash)
						) {
							// new order
							checkTradeUpdates = true;
						}
						if (myOrder.orderSide === OrderSide.Buy) {
							pmmOrderbook.trading.activeOrders.buys.set(myOrder.orderHash, myOrder);
						} else if (myOrder.orderSide === OrderSide.Sell) {
							pmmOrderbook.trading.activeOrders.sells.set(myOrder.orderHash, myOrder);
						}
					}
				}
			}),
		);

		return checkTradeUpdates;
	};

	/**
	 *
	 */
	setMyTrades = async () => {
		await Promise.all(
			this.PMMOrderbooks.map(async (pmmOrderbook) => {
				const tradeHistory = await this.chainOperator.client.queryOrderbookTrades(
					pmmOrderbook.marketId,
					this.chainOperator.client.subaccountId,
					this.startTimestamp,
				);
				if (tradeHistory) {
					pmmOrderbook.trading.tradeHistory.trades = tradeHistory.trades;
					pmmOrderbook.trading.tradeHistory.summary.grossGainInQuote = calculateTradeHistoryProfit(
						pmmOrderbook,
						tradeHistory.trades,
					);
				}

				// const portfolio = await this.chainOperator.queryAccountPortfolio();

				// if (portfolio) {
				// 	this.tradeHistory.summary.currentValueInQuote = calculatePortfolioValue(this.orderbooks[0], portfolio);
				// }
			}),
		);
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
		await this.setMyOrders();
		await this.executeOrderOperations();
		this.scheduler.startOrderUpdates(300 * 1000);
		this.scheduler.startLogTimer(this.botConfig.signOfLife * 60 * 1000, this);
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
		const PMMOrderbooks = await initPMMOrderbooks(orderbooks, botConfig);
		const getOrderbookState = chains.injective.getOrderbookState;

		const loop = new PMMLoop(chainOperator, botConfig, logger, PMMOrderbooks, getOrderbookState);
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
