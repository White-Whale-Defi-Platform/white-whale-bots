import { SpotLimitOrder } from "@injectivelabs/sdk-ts";
import { OrderSide, TradeDirection } from "@injectivelabs/ts-types";

import { TxResponse } from "../chainOperator/chainOperatorInterface";
import { LiquidationLoop } from "../strategies/arbitrage/loops/liqMempoolLoop";
import { DexLoopInterface } from "../strategies/arbitrage/loops/loopinterfaces/dexloopInterface";
import { PMMLoop } from "../strategies/pmm/loops/pmmloop";
import { OrderOperation } from "../strategies/pmm/operations/validateOrders";
import { isNativeAsset, NativeAssetInfo } from "../types/base/asset";
import { BotConfig } from "../types/base/configs";
import { LogType } from "../types/base/logging";
import { getOrderbookMidPrice } from "../types/base/orderbook";
import { Loan } from "../types/base/overseer";
import { OrderSequence } from "../types/base/path";
import { outGivenIn } from "../types/base/pool";
import { OptimalOrderbookTrade, OptimalTrade } from "../types/base/trades";
import { DiscordLogger } from "./discordLogger";
import { SlackLogger } from "./slackLogger";
import { TelegramLogger } from "./telegramLogger";
/**
 *
 */
export class Logger {
	botConfig: BotConfig;
	public discordLogger?: DiscordLogger;
	public slackLogger?: SlackLogger;
	private telegramLogger?: TelegramLogger;

	// Codes that are not sent to external sources (discord, slack)
	externalExemptCodes: Array<number> = [];

	/**
	 *
	 */
	constructor(config: BotConfig) {
		this.botConfig = config;

		this.externalExemptCodes = this.botConfig.loggerConfig.externalExemptCodes ?? [];

		if (this.botConfig.loggerConfig.discordWebhookUrl) {
			this.discordLogger = new DiscordLogger(this.botConfig.loggerConfig.discordWebhookUrl);
		}

		if (this.botConfig.loggerConfig.telegramBotToken && this.botConfig.loggerConfig.telegramChatId) {
			this.telegramLogger = new TelegramLogger(
				this.botConfig.loggerConfig.telegramBotToken,
				this.botConfig.loggerConfig.telegramChatId,
			);
		}

		if (this.botConfig.loggerConfig.slackToken && this.botConfig.loggerConfig.slackChannel) {
			this.slackLogger = new SlackLogger(
				this.botConfig.loggerConfig.slackToken,
				this.botConfig.loggerConfig.slackChannel,
			);
		}
	}

	public loopLogging = {
		/**
		 *
		 */
		_sendMessage: async (message: string, type: LogType = LogType.All, code = -1) =>
			this.sendMessage(message, type, code),
		/**
		 *
		 */
		async logConfig(botConfig: BotConfig) {
			//todo: place this in the logger class
			let startupMessage = "===".repeat(30);
			startupMessage += "\n**White Whale Bot**";
			startupMessage += `\n**Setup type: ${botConfig.setupType}**\n`;
			startupMessage += "===".repeat(30);

			startupMessage += `\nEnvironment Variables:\n
**RPC ENPDOINTS:** \t${botConfig.rpcUrls}
**USE MEMPOOL:** \t${botConfig.useMempool}
**USE SKIP:** \t${botConfig.skipConfig?.useSkip}
				`;
			if (botConfig.skipConfig) {
				startupMessage += `**SKIP URL:** \t${botConfig.skipConfig.skipRpcUrl}\n`;
				startupMessage += `**SKIP BID RATE:** \t${botConfig.skipConfig.skipBidRate}\n`;
			}
			startupMessage += "\n";
			startupMessage += "---".repeat(30);
			await this._sendMessage(startupMessage, LogType.All);
		},
		/**
		 *
		 */
		async logDexLoop(loop: DexLoopInterface) {
			let setupMessage = "---".repeat(30);
			setupMessage += `\n**Derived Paths for Arbitrage:**`;
			setupMessage += `\nTotal AMM Paths: \t${loop.paths.length}\n`;
			for (let pathlength = 2; pathlength <= loop.botConfig.maxPathPools; pathlength++) {
				const nrOfPaths = loop.paths.filter((path) => path.pools.length === pathlength).length;
				setupMessage += `${pathlength} HOP Paths: \t${nrOfPaths}\n`;
			}
			setupMessage += `\n**Orderbooks: **${loop.orderbooks.map(
				(ob) => `\n[${ob.quoteAssetInfo.native_token.denom} - ${ob.baseAssetInfo.native_token.denom}]`,
			)}`;
			setupMessage += `\n**Total Orderbook paths: ** \t${loop.orderbookPaths.length}\n`;
			setupMessage += "---".repeat(30);
			await this._sendMessage(setupMessage, LogType.All);
		},

		/**
		 *
		 */
		async logLiqLoop(loop: LiquidationLoop) {
			const allLoans: Array<Loan> = [];
			loop.overseers.map((overseer) => {
				for (const loan of Object.values(overseer.loans)) {
					allLoans.push(loan);
				}
			});
			const maxRisk = allLoans.sort((a, b) => b.riskRatio - a.riskRatio);
			const totalLoan = allLoans.map((loan) => loan.loanAmt).reduce((sum, current) => (sum += current), 0);
			let setupMessage = "---".repeat(30);
			setupMessage += `\n**Derived Overseers: ${Object.keys(loop.allOverseerAddresses)}`;
			setupMessage += `\n**Max Risk ratio: ${maxRisk[0].riskRatio.toPrecision(3)}
Min Risk ratio: ${maxRisk[maxRisk.length - 1].riskRatio.toPrecision(3)}`;
			setupMessage += `\n**Amount of outstanding loans: ${allLoans.length}`;
			setupMessage += `\n**Total amount of outstanding value: ${totalLoan / 1e6}`;

			await this._sendMessage(setupMessage, LogType.All);
		},

		/**
		 *
		 */
		async logPMMLoop(loop: PMMLoop, date: Date) {
			const formatOptions: Intl.DateTimeFormatOptions = {
				year: "numeric",
				month: "numeric",
				day: "numeric",
			};
			let logmsg = ``;
			logmsg += `\n**${date.toLocaleTimeString("nl-NL", formatOptions)}**`;
			logmsg += `\n**MARKET:** \t${loop.orderbooks[0].ticker}`;
			logmsg += `\n**MID PRICE:** \t${getOrderbookMidPrice(loop.orderbooks[0])}`;
			logmsg += `\n**NET GAIN:** \t${
				Math.round(
					(loop.tradeHistory.summary.currentValueInQuote - loop.tradeHistory.summary.startingValueInQuote) *
						10e6,
				) / 10e6
			}`;
			logmsg += `\n**GROSS GAIN:** \t${loop.tradeHistory.summary.grossGainInQuote}`;
			logmsg += `\n${"---------"}**Active Orders**${"---------"}`;
			loop.activeOrders.buys.forEach((buyOrder) => {
				logmsg += `\nbuy : ${buyOrder.quantity} @ ${buyOrder.price}`;
			});
			loop.activeOrders.sells.forEach((sellOrder) => {
				logmsg += `\nsell: ${sellOrder.quantity} @ ${sellOrder.price}`;
			});

			const histBuys = Array.from(loop.tradeHistory.trades.values()).filter(
				(trade) => trade.tradeDirection === TradeDirection.Buy,
			);
			const histBuysAvgPrice = histBuys.map((buy) => +buy.price).reduce((a, b) => a + b, 0) / histBuys.length;

			const histSells = Array.from(loop.tradeHistory.trades.values()).filter(
				(trade) => trade.tradeDirection === TradeDirection.Sell,
			);
			const histSellsAvgPrice = histSells.map((buy) => +buy.price).reduce((a, b) => a + b, 0) / histSells.length;
			logmsg += `\n${"---------"}**Recent Trades**${"---------"}`;
			logmsg += `\n${histSells.length} sells ${histSellsAvgPrice ? `of average price ${histSellsAvgPrice}` : ""}`;
			logmsg += `\n${histBuys.length} buys  ${histBuysAvgPrice ? `of average price ${histBuysAvgPrice}` : ""}`;

			await loop.logger?.sendMessage(logmsg);
		},
	};

	public tradeLogging = {
		/**
		 *
		 */
		_sendMessage: async (message: string, type: LogType = LogType.All, code = -1) =>
			this.sendMessage(message, type, code),

		/**
		 *
		 */
		async logOrderbookTrade(arbtradeOB: OptimalOrderbookTrade, txResponse: TxResponse) {
			let tradeMsg = "-".repeat(39) + "Orderbook Arb" + "-".repeat(38);
			if (txResponse.code !== 0) {
				tradeMsg += `\n**Error in Broadcasting**`;
				tradeMsg += `\nCode: ${txResponse.code}`;
				tradeMsg += `\nLog: ${txResponse.rawLog}`;
				tradeMsg += `\nHash: ${txResponse.transactionHash}`;
			} else {
				tradeMsg += `\n**Offering: ${arbtradeOB.offerAsset.amount}${
					(<NativeAssetInfo>arbtradeOB.offerAsset.info).native_token.denom
				}`;
				if (arbtradeOB.path.orderSequence === OrderSequence.AmmFirst) {
					tradeMsg += `\n**Pool: ${arbtradeOB.path.pool.address}: ${arbtradeOB.path.pool.assets[0].amount}${
						(<NativeAssetInfo>arbtradeOB.path.pool.assets[0].info).native_token.denom
					}/${arbtradeOB.path.pool.assets[1].amount}${
						(<NativeAssetInfo>arbtradeOB.path.pool.assets[1].info).native_token.denom
					}`;
					tradeMsg += `\n**OutGivenInPool: ${outGivenIn(arbtradeOB.path.pool, arbtradeOB.offerAsset).amount}`;
					tradeMsg += `\n**Orderbook: ${
						(<NativeAssetInfo>arbtradeOB.path.orderbook.baseAssetInfo).native_token.denom
					} / USDT`;
					tradeMsg += `\n**OutGivenInOrderbook: ${arbtradeOB.outGivenInOrderbook}`;
				} else {
					const outGivenInOrderbook =
						Math.floor(arbtradeOB.outGivenInOrderbook / arbtradeOB.path.orderbook.minQuantityIncrement) *
						arbtradeOB.path.orderbook.minQuantityIncrement;

					const offerAssetPool = {
						amount: String(outGivenInOrderbook),
						info: arbtradeOB.path.orderbook.baseAssetInfo,
						decimals: arbtradeOB.path.orderbook.baseAssetDecimals,
					};
					tradeMsg += `\n**Orderbook: ${
						(<NativeAssetInfo>arbtradeOB.path.orderbook.baseAssetInfo).native_token.denom
					} / USDT`;
					tradeMsg += `\n**OutGivenInOrderbook: ${outGivenInOrderbook}`;
					tradeMsg += `\n**Pool: ${arbtradeOB.path.pool.address}: ${arbtradeOB.path.pool.assets[0].amount}${
						(<NativeAssetInfo>arbtradeOB.path.pool.assets[0].info).native_token.denom
					}/${arbtradeOB.path.pool.assets[1].amount}${
						(<NativeAssetInfo>arbtradeOB.path.pool.assets[1].info).native_token.denom
					}`;
					tradeMsg += `\n**OutGivenInPool: ${outGivenIn(arbtradeOB.path.pool, offerAssetPool).amount}`;
				}
				tradeMsg += `\n**Expected profit: ${arbtradeOB.profit}`;
				tradeMsg += `\nHash: ${txResponse.transactionHash ?? "unknown"}`;
			}
			await this._sendMessage(tradeMsg, LogType.All);
		},
		/**
		 *
		 */
		async logOrderbookPositionUpdate(
			loop: PMMLoop,
			ordersToCancel: Array<SpotLimitOrder> | undefined,
			ordersToCreate: Array<OrderOperation> | undefined,
		) {
			const formatOptions: Intl.DateTimeFormatOptions = {
				year: "numeric",
				month: "numeric",
				day: "numeric",
			};
			let logmsg = ``;
			logmsg += `\n**${new Date().toLocaleTimeString("nl-NL", formatOptions)}**`;
			logmsg += `\n**MARKET:** \t${loop.orderbooks[0].ticker}`;
			logmsg += `\n**MID PRICE:** \t${getOrderbookMidPrice(loop.orderbooks[0])}`;
			logmsg += `\n${"---------"}**Order Updates**${"---------"}`;

			for (const orderToCancel of ordersToCancel ?? []) {
				logmsg += `\n**cancelling** ${orderToCancel.orderSide === OrderSide.Sell ? "sell" : "buy"}: ${
					orderToCancel.quantity
				} @ ${orderToCancel.price}`;
			}
			for (const orderToCreate of ordersToCreate ?? []) {
				logmsg += `\n**opening** ${orderToCreate.orderSide === OrderSide.Sell ? "sell" : "buy"}: ${
					orderToCreate.quantity
				} @ ${orderToCreate.price}`;
			}

			logmsg += `\n${"---------"}**-------------**${"---------"}`;
			await loop.logger?.sendMessage(logmsg);
		},

		/**
		 *
		 */
		async logAmmTrade(arbTrade: OptimalTrade, txResponse: TxResponse) {
			let tradeMsg = "-".repeat(42) + "AMM Arb" + "-".repeat(41);
			if (txResponse.code !== 0) {
				tradeMsg += `\n**Error in Broadcasting**`;
				tradeMsg += `\nCode: ${txResponse.code}`;
				tradeMsg += `\nLog: ${txResponse.rawLog}`;
				tradeMsg += `\nHash: ${txResponse.transactionHash}`;
			} else {
				arbTrade.path.pools.forEach((pool) => {
					tradeMsg += `\n**Pool: ${pool.address} with Assets: ${pool.assets[0].amount} ${
						isNativeAsset(pool.assets[0].info)
							? pool.assets[0].info.native_token.denom
							: pool.assets[0].info.token.contract_addr
					} / ${pool.assets[1].amount} ${
						isNativeAsset(pool.assets[1].info)
							? pool.assets[1].info.native_token.denom
							: pool.assets[1].info.token.contract_addr
					}`;
				});
				tradeMsg += `\n**Offering: ${arbTrade.offerAsset.amount}${
					(<NativeAssetInfo>arbTrade.offerAsset.info).native_token.denom
				}`;
				tradeMsg += `\n**Expected profit: ${arbTrade.profit}`;
				tradeMsg += `\nHash: ${txResponse.transactionHash ?? "unknown"}`;
			}
			await this._sendMessage(tradeMsg, LogType.All);
		},
	};
	/**
	 * Sends the `message` to the console and other external messaging systems if defined.
	 * @param message The message to log.
	 * @param type The type of message, values of type LogType.
	 * @param code The code number of the message, -1 if not given.
	 */
	public async sendMessage(message: string, type: LogType = LogType.All, code = -1) {
		if (message) {
			// Don't send common errors to discord/slack
			if (
				type != LogType.Console &&
				this.externalExemptCodes.length > 0 &&
				!this.externalExemptCodes.includes(code)
			) {
				// Add indicator on success
				if (code === 0) message = ":tada: **Success!** :tada:\n" + message;

				if (this.discordLogger && [LogType.All, LogType.Externals, LogType.Discord].includes(type)) {
					await this.discordLogger.sendMessage(message);
				}

				if (this.telegramLogger && [LogType.All, LogType.Externals, LogType.Telegram].includes(type)) {
					await this.telegramLogger.sendMessage(message);
				}

				if (this.slackLogger && [LogType.All, LogType.Externals, LogType.Slack].includes(type)) {
					message = message.replaceAll("**", "*");
					await this.slackLogger.sendMessage(message);
				}
			}

			if ([LogType.All, LogType.Console].includes(type)) {
				message = message.replaceAll("**", "").replaceAll("*", "");
				console.log(message);
			}
		}
	}
}
