import { DexLoopInterface } from "../types/arbitrageloops/interfaces/dexloopInterface";
import { LiquidationLoop } from "../types/arbitrageloops/loops/liqMempoolLoop";
import { BotConfig } from "../types/base/configs";
import { LogType } from "../types/base/logging";
import { DiscordLogger } from "./discordLogger";
import { SlackLogger } from "./slackLogger";
import { TelegramLogger } from "./telegramLogger";

/**
 *
 */
export class Logger {
	private botConfig: BotConfig;
	public discordLogger?: DiscordLogger;
	public slackLogger?: SlackLogger;
	private telegramLogger?: TelegramLogger;

	// Codes that are not sent to external sources (discord, slack)
	private externalExemptCodes: Array<number> = [];

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
		_sendMessage: this.sendMessage,
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
			let setupMessage = "---".repeat(30);
			setupMessage += `**\nDerived Overseers: ${loop.allOverseerAddresses}`;
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
			if (type != LogType.Console && !this.externalExemptCodes.includes(code)) {
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
