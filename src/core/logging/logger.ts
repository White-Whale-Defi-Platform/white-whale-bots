import { DexLoopInterface } from "../types/arbitrageloops/interfaces/dexloopInterface";
import { LiquidationLoop } from "../types/arbitrageloops/loops/liqMempoolLoop";
import { BotConfig } from "../types/base/configs";
import { LogType } from "../types/base/logging";
import { Loan } from "../types/base/overseer";
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
	public defaults = {
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
			startupMessage += "\n**White Whale Bot**\n";
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
			setupMessage += `**\nDerived Paths for Arbitrage:
				Total Paths:** \t${loop.paths.length}\n`;
			for (let pathlength = 2; pathlength <= loop.botConfig.maxPathPools; pathlength++) {
				const nrOfPaths = loop.paths.filter((path) => path.pools.length === pathlength).length;
				setupMessage += `**${pathlength} HOP Paths:** \t${nrOfPaths}\n`;
			}
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
			setupMessage += `**\nDerived Overseers: ${Object.keys(loop.allOverseerAddresses)}`;
			setupMessage += `**\nMax Risk ratio: ${maxRisk[0].riskRatio.toPrecision(3)}
Min Risk ratio: ${maxRisk[maxRisk.length - 1].riskRatio.toPrecision(3)}`;
			setupMessage += `**\nAmount of outstanding loans: ${allLoans.length}`;
			setupMessage += `**\nTotal amount of outstanding value: ${totalLoan / 1e6}`;

			await this._sendMessage(setupMessage, LogType.All);
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
				message = message.replaceAll("**", "");
				console.log(message);
			}
		}
	}
}
