import { StdFee } from "@cosmjs/stargate";
import { OrderSide } from "@injectivelabs/ts-types";

import * as chains from "../../../../chains";
import { initOrderbooks } from "../../../../chains/inj";
import { getBatchCancelOrdersMessage } from "../../../../chains/inj/messages/getBatchCancelOrdersMessage";
import { getBatchUpdateOrdersMessage } from "../../../../chains/inj/messages/getBatchUpdateOrdersMessage";
import { getSubaccountOrders } from "../../../../chains/inj/queries/getOrderbookOrders";
import { initPMMOrderbooks } from "../../../../chains/inj/queries/initOrderbook";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { PMMConfig } from "../../../types/base/configs";
import { Inventory, inventorySkew, netWorth } from "../../../types/base/inventory";
import { Orderbook, PMMOrderbook } from "../../../types/base/orderbook";
import { getOrderOperations, OrderbookOrderOperations } from "../operations/getOrderOperations";
import Scheduler from "../operations/scheduling";
import { setPMMParameters } from "../operations/setParameters";
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

	inventory: {
		initialQuoteAmount: number;
		killSwitchQuoteAmount: number;
		currentQuoteAmount: number;
		inventory: Inventory;
	} = {
		initialQuoteAmount: 0,
		killSwitchQuoteAmount: 0,
		currentQuoteAmount: 0,
		inventory: {} as Inventory,
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
		while (true && this.inventory.currentQuoteAmount > this.inventory.killSwitchQuoteAmount) {
			await this.setMyOrders();

			await this.setMyTrades();

			await this.updateOrderbookStates(this.chainOperator, this.PMMOrderbooks);
		}
		console.log(
			`cancelling bot, too much loss: started at ${this.inventory.initialQuoteAmount} and current ${this.inventory.currentQuoteAmount}`,
		);
		return;
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
	executeOrderOperations = async (marketIds?: Array<string>) => {
		const allOrderbookUpdates: Array<OrderbookOrderOperations> = [];
		this.PMMOrderbooks.forEach((pmmOrderbook) => {
			if (
				(marketIds && !marketIds.includes(pmmOrderbook.marketId)) ||
				this.marketsOnCooldown.includes(pmmOrderbook.marketId)
			) {
				//do nothing
			} else {
				const { ordersToCancel, ordersToCreate } = getOrderOperations(pmmOrderbook);
				if (ordersToCancel.length > 0 || ordersToCreate.length > 0) {
					allOrderbookUpdates.push({
						orderbook: pmmOrderbook,
						ordersToCancelHashes: ordersToCancel,
						ordersToCreate: ordersToCreate,
					});
				}
				if (ordersToCancel.length > 0) {
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
		await Promise.all(
			this.PMMOrderbooks.map(async (pmmOrderbook) => {
				const activeOrders = await getSubaccountOrders(this.chainOperator, pmmOrderbook);

				if (activeOrders) {
					const myOrdersHashes = activeOrders.orders.map((order) => order.orderHash);
					for (const buyOrderHash of pmmOrderbook.trading.activeOrders.buys.keys()) {
						if (!myOrdersHashes.includes(buyOrderHash)) {
							pmmOrderbook.trading.activeOrders.buys.delete(buyOrderHash);
						}
					}
					for (const sellOrderHash of pmmOrderbook.trading.activeOrders.sells.keys()) {
						if (!myOrdersHashes.includes(sellOrderHash)) {
							pmmOrderbook.trading.activeOrders.sells.delete(sellOrderHash);
						}
					}

					for (const myOrder of activeOrders.orders) {
						if (
							!pmmOrderbook.trading.activeOrders.buys.has(myOrder.orderHash) &&
							!pmmOrderbook.trading.activeOrders.sells.has(myOrder.orderHash)
						) {
							if (myOrder.orderSide === OrderSide.Buy) {
								pmmOrderbook.trading.activeOrders.buys.set(myOrder.orderHash, myOrder);
							} else if (myOrder.orderSide === OrderSide.Sell) {
								pmmOrderbook.trading.activeOrders.sells.set(myOrder.orderHash, myOrder);
							}
						}
					}
				}
			}),
		);
	};

	/**
	 *
	 */
	setMyTrades = async (init = false) => {
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

				if (tradeHistoryChain && tradeHistoryChain.trades.length > 0) {
					tradeHistoryChain.trades.forEach((thc) => {
						if (tradeHistoryLocal.find((thl) => thl === thc.orderHash) === undefined) {
							triggerCooldown = true;
							orderbooksToCooldown.push(pmmOrderbook);
						}
					});

					pmmOrderbook.trading.tradeHistory.summary.grossGainInQuote = calculateTradeHistoryProfit(
						pmmOrderbook,
						tradeHistoryChain.trades,
					);

					pmmOrderbook.trading.tradeHistory.trades = tradeHistoryChain.trades;
				}
			}),
		);
		if (triggerCooldown && init === false) {
			const marketsToCooldown = orderbooksToCooldown.map((ob) => ob.marketId);
			this.marketsOnCooldown.push(...marketsToCooldown);
			await this.setMyInventory(marketsToCooldown);
			this.scheduler.setOrderCooldown(5 * 1000, marketsToCooldown);

			// await this.logger?.loopLogging.logPMMLoop(this, new Date());
		}
	};

	/**
	 *
	 */
	async setMyInventory(marketIds: Array<string> | undefined = undefined) {
		const inventory = await this.chainOperator.queryAccountPortfolio();
		if (!inventory) {
			return;
		}
		this.inventory.inventory = inventory;
		this.inventory.currentQuoteAmount = netWorth(this.PMMOrderbooks, inventory);
		await Promise.all(
			this.PMMOrderbooks.map(async (orderbook) => {
				if (marketIds && !marketIds.includes(orderbook.marketId)) {
					// console.log("skipping inventory skew for :", orderbook.ticker);
				} else {
					// console.log(" setting inventory skew for: ", orderbook.ticker);
					const marketInventorySkew = Math.round(inventorySkew(inventory, orderbook) * 100);
					orderbook.trading.inventorySkew = marketInventorySkew;
					// console.log("skew: ", marketInventorySkew);
				}
			}),
		);
	}
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
		} else {
			const txRes = await this.chainOperator.signAndBroadcast([msgBatchUpdateOrders]);
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
	endOfCooldown = async (marketIds: Array<string>) => {
		this.marketsOnCooldown = this.marketsOnCooldown.filter((cdMarketId) => !marketIds.includes(cdMarketId));
		this.scheduler.emit("updateOrders", marketIds);
	};
	/**
	 *
	 */
	public async cancelAllOrders() {
		const allOnChainOrders = await getSubaccountOrders(this.chainOperator);
		if (!allOnChainOrders) {
			console.log("no orders to cancel");
			return;
		}
		const allOrders = allOnChainOrders.orders;
		const cancelMsg = getBatchCancelOrdersMessage(this.chainOperator, allOrders);

		const decimalCompensator = this.botConfig.gasDenom === "inj" ? 1e12 : 1;
		const gas = 200000 + 30000 * allOrders.length;
		const gasFee = {
			denom: this.botConfig.gasDenom,
			amount: (gas * this.botConfig.gasPrice * decimalCompensator).toFixed(),
		};
		const fee: StdFee = { amount: [gasFee], gas: String(gas) };
		const txRes = await this.chainOperator.signAndBroadcast([cancelMsg], fee);
		console.log(`cancelling ${allOrders.length} current orders:  ${txRes.transactionHash}`);
	}
	/**
	 *
	 */
	public async reset() {
		await this.setMyOrders();
		await this.setMyTrades();
		await this.setMyInventory();
		await this.updatePMMParameters();
		//do something later
	}

	/**
	 *
	 */
	public async init() {
		await this.cancelAllOrders();

		await delay(5000);
		await this.setMyOrders();
		await this.setMyTrades(true);
		await this.setMyInventory(undefined);
		await this.updatePMMParameters();

		const inventory = await this.chainOperator.queryAccountPortfolio();
		if (inventory) {
			this.inventory.initialQuoteAmount = netWorth(this.PMMOrderbooks, inventory);
			this.inventory.inventory = inventory;
			this.inventory.killSwitchQuoteAmount =
				this.inventory.initialQuoteAmount - 0.1 * this.botConfig.maxCapitalUsed;
		}

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
