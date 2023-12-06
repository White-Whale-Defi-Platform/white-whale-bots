import { StdFee } from "@cosmjs/stargate";
import { OrderSide, TradeDirection } from "@injectivelabs/ts-types";

import * as chains from "../../../../chains";
import { initOrderbooks } from "../../../../chains/inj";
import { getBatchUpdateOrdersMessage } from "../../../../chains/inj/messages/getBatchUpdateOrdersMessage";
import { getSubaccountOrders } from "../../../../chains/inj/queries/getOrderbookOrders";
import { initPMMOrderbooks } from "../../../../chains/inj/queries/initOrderbook";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { PMMConfig } from "../../../types/base/configs";
import { Orderbook, PMMOrderbook } from "../../../types/base/orderbook";
import { getOrderOperations, OrderbookOrderOperations } from "../operations/getOrderOperations";
import { setPMMParameters } from "../operations/marketAnalysis";
import Scheduler from "../operations/scheduling";
import { calculateTradeHistoryProfit } from "../operations/tradeHistoryProfit";

/**
 *
 */
export class PMMLoop {
	PMMOrderbooks: Array<PMMOrderbook>;
	logger: Logger | undefined;
	chainOperator: ChainOperator;
	botConfig: PMMConfig;
	startTimestamp = Date.now();
	marketsOnCooldown: Array<string> = [];

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
		this.scheduler.addListener("endOfCooldown", this.endOfCooldown);
		this.scheduler.addListener("updateParameters", this.updatePMMParameters);
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
	executeOrderOperations = async (marketId?: string) => {
		const allOrderbookUpdates: Array<OrderbookOrderOperations> = [];
		this.PMMOrderbooks.forEach((pmmOrderbook) => {
			if (
				(marketId && !(pmmOrderbook.marketId === marketId)) ||
				this.marketsOnCooldown.includes(pmmOrderbook.marketId)
			) {
				console.log("skipping ob", pmmOrderbook.ticker);
			} else {
				const { ordersToCancel, ordersToCreate } = getOrderOperations(
					pmmOrderbook,
					pmmOrderbook.trading.activeOrders.buys.size === 0
						? undefined
						: pmmOrderbook.trading.activeOrders.buys,
					pmmOrderbook.trading.activeOrders.sells.size === 0
						? undefined
						: pmmOrderbook.trading.activeOrders.sells,
				);
				if (ordersToCancel || ordersToCreate) {
					allOrderbookUpdates.push({
						orderbook: pmmOrderbook,
						ordersToCancelHashes: ordersToCancel ?? [],
						ordersToCreate: ordersToCreate ?? [],
					});
				}
				if (ordersToCancel) {
					for (const orderToCancel of ordersToCancel) {
						pmmOrderbook.trading.activeOrders.buys.delete(orderToCancel);
						pmmOrderbook.trading.activeOrders.sells.delete(orderToCancel);
					}
				}
			}
		});
		if (allOrderbookUpdates.length > 0) {
			await this.trade(allOrderbookUpdates);
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
		let triggerCooldown = false;
		const orderbooksToCooldown: Array<PMMOrderbook> = [];
		await Promise.all(
			this.PMMOrderbooks.map(async (pmmOrderbook) => {
				const tradeHistoryLocal = pmmOrderbook.trading.tradeHistory.trades.map((st) => st.orderHash);
				const tradeHistoryChain = await this.chainOperator.client.queryOrderbookTrades(
					pmmOrderbook.marketId,
					this.chainOperator.client.subaccountId,
					this.startTimestamp,
				);
				if (tradeHistoryChain) {
					tradeHistoryChain.trades.forEach((thc) => {
						if (tradeHistoryLocal.find((thl) => thl === thc.orderHash) === undefined) {
							triggerCooldown = true;
							orderbooksToCooldown.push(pmmOrderbook);
							if (thc.tradeDirection === TradeDirection.Buy) {
								pmmOrderbook.trading.buyAllowed = false;
								pmmOrderbook.trading.sellAllowed = true;
							} else {
								pmmOrderbook.trading.buyAllowed = true;
								pmmOrderbook.trading.sellAllowed = false;
							}
						}
					});

					pmmOrderbook.trading.tradeHistory.summary.grossGainInQuote = calculateTradeHistoryProfit(
						pmmOrderbook,
						tradeHistoryChain.trades,
					);

					pmmOrderbook.trading.tradeHistory.trades = tradeHistoryChain.trades;
				}

				// const portfolio = await this.chainOperator.queryAccountPortfolio();

				// if (portfolio) {
				// 	this.tradeHistory.summary.currentValueInQuote = calculatePortfolioValue(this.orderbooks[0], portfolio);
				// }
			}),
		);
		if (triggerCooldown) {
			console.log(
				"obtained new trade hash on chain-->trade happened-->going into cooldown for 3 minutes for: ",
				orderbooksToCooldown.map((ob) => ob.ticker),
				"switching trade side",
			);

			orderbooksToCooldown.forEach((ob) => {
				this.marketsOnCooldown.push(ob.marketId);
				this.scheduler.setOrderCooldown(180 * 1000, ob.marketId);
			});
			await this.logger?.loopLogging.logPMMLoop(this, new Date());
		}
	};

	/**
	 *
	 */
	async trade(orderUpdates: Array<OrderbookOrderOperations>) {
		const [msgBatchUpdateOrders, nrOfOperations] = getBatchUpdateOrdersMessage(this.chainOperator, orderUpdates);
		if (nrOfOperations > 2) {
			const decimalCompensator = this.botConfig.gasDenom === "inj" ? 1e12 : 1;
			const gas = 200000 + 30000 * nrOfOperations;
			const gasFee = {
				denom: this.botConfig.gasDenom,
				amount: (gas * this.botConfig.gasPrice * decimalCompensator).toFixed(),
			};
			const fee: StdFee = { amount: [gasFee], gas: String(gas) };
			const txRes = await this.chainOperator.signAndBroadcast([msgBatchUpdateOrders], fee);
			console.log(txRes.transactionHash);
		} else {
			const txRes = await this.chainOperator.signAndBroadcast([msgBatchUpdateOrders]);
			console.log(txRes.transactionHash);
		}
		await this.logger?.tradeLogging.logOrderbookPositionUpdate(orderUpdates);
	}
	/**
	 *
	 */
	updatePMMParameters = async () => {
		for (const pmmOrderbook of this.PMMOrderbooks) {
			await setPMMParameters(pmmOrderbook, "15", "28");
		}
	};
	/**
	 *
	 */
	endOfCooldown = async (marketId: string) => {
		this.marketsOnCooldown = this.marketsOnCooldown.filter((cdMarketId) => cdMarketId != marketId);
		console.log("end of cooldown triggered for ", marketId);

		// this.scheduler.emit("updateOrders", marketId);
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
		await this.updatePMMParameters();
		await this.setMyOrders();
		await this.executeOrderOperations();
		this.scheduler.startOrderUpdates(this.botConfig.orderRefreshTime * 1000);
		this.scheduler.startLogTimer(this.botConfig.signOfLife * 60 * 1000, this);
		this.scheduler.startParameterUpdates(15 * 60 * 1000);
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
		const PMMOrderbooks = await initPMMOrderbooks(chainOperator, orderbooks, botConfig);
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
