import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import { SpotLimitOrder, SpotTrade } from "@injectivelabs/sdk-ts";
import { IndexerRestMarketChronosApi } from "@injectivelabs/sdk-ts";
import { OrderSide } from "@injectivelabs/ts-types";
import { inspect } from "util";

import * as chains from "../../../../chains";
import { initOrderbooks } from "../../../../chains/inj";
import { getBatchUpdateOrdersMessage } from "../../../../chains/inj/messages/getBatchUpdateOrdersMessage";
import { getSubaccountOrders } from "../../../../chains/inj/queries/getOrderbookOrders";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { PMMConfig } from "../../../types/base/configs";
import { getOrderbookMidPrice, Orderbook } from "../../../types/base/orderbook";
import Scheduler from "../operations/scheduling";
import { validateOrders } from "../operations/validateOrders";

/**
 *
 */
export async function marketHistory() {
	const network = Network.MainnetSentry;
	const endpoints = getNetworkEndpoints(network);
	const fetcher = new IndexerRestMarketChronosApi(`${endpoints.indexer}/api/chronos/v1/market`);
	const res = await fetcher.fetchMarketsHistory({
		marketIds: ["0x0511ddc4e6586f3bfe1acb2dd905f8b8a82c97e1edaef654b12ca7e6031ca0fa"],
		resolution: "15",
		countback: "48",
	});
	console.log(res);
}
/**
 *
 */
export class PMMLoop {
	orderbooks: Array<Orderbook>;
	logger: Logger | undefined;
	chainOperator: ChainOperator;
	botConfig: PMMConfig;
	iterations = 0;
	activeOrders: { buys: Map<string, SpotLimitOrder>; sells: Map<string, SpotLimitOrder> } = {
		buys: new Map(),
		sells: new Map(),
	};
	tradeHistory: Array<SpotTrade>;
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
		this.scheduler.addListener("updateOrders", this.executeOrderOperations);
		this.scheduler.addListener("logTrigger", this.logState);
		this.tradeHistory = [];
	}

	/**
	 *
	 */
	public async step() {
		await this.setMyOrders();
		await this.setMyTrades();
		await this.logState(new Date());
		await this.executeOrderOperations();

		this.scheduler.startOrderUpdates(this.botConfig.orderRefreshTime * 1000);
		this.scheduler.startLogTimer(this.botConfig.signOfLife * 60 * 1000);

		while (true) {
			this.iterations++;
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
		console.log(time ?? "", ordersToCancel, ordersToCreate);
		if (ordersToCancel || ordersToCreate) {
			const msgBatchUpdateOrders = getBatchUpdateOrdersMessage(
				this.chainOperator,
				this.orderbooks[0],
				ordersToCancel,
				ordersToCreate,
			);
			console.log(inspect(msgBatchUpdateOrders, true, null, true));
			const txRes = await this.chainOperator.signAndBroadcast([msgBatchUpdateOrders]);
			console.log(txRes.transactionHash);
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
		console.log("updating trade history");
		const tradeHistory = await this.chainOperator.client.queryOrderbookTrades(
			this.orderbooks[0].marketId,
			this.chainOperator.client.subaccountId,
		);
		if (tradeHistory) {
			this.tradeHistory = tradeHistory.trades;
		}
		await this.logState(new Date());
	};

	/**
	 *
	 */
	logState = async (date: Date) => {
		let logmsg = ``;
		logmsg += `**${date}**`;
		logmsg += `\n**MARKET:** \t${this.orderbooks[0].baseAssetInfo.native_token.denom} / USDT`;
		logmsg += `\n**MID PRICE:** \t${getOrderbookMidPrice(this.orderbooks[0])}`;
		logmsg += `\n ${"---".repeat(20)}**Active Orders**${"---".repeat(20)}`;
		this.activeOrders.buys.forEach((buyOrder) => {
			logmsg += `\nbuy: ${buyOrder.quantity} @ ${buyOrder.price}, ${buyOrder.orderHash}`;
		});
		this.activeOrders.sells.forEach((sellOrder) => {
			logmsg += `\nsell: ${sellOrder.quantity} @ ${sellOrder.price}, ${sellOrder.orderHash}`;
		});
		logmsg += `\n ${"---".repeat(20)}**Recent Trades**${"---".repeat(20)}`;
		for (const trade of this.tradeHistory.slice(0, 5)) {
			logmsg += `\n${trade.tradeDirection}: ${trade.quantity} @ ${trade.price}, ${trade.orderHash}`;
		}
		await this.logger?.sendMessage(logmsg);
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
