import { BotConfig } from "../types/base/botConfig";
import { LogType } from "../types/base/logging";
import { DiscordLogger } from "./discordLogger";
import { SlackLogger } from "./slackLogger";

/**
 *
 */
export class Logger {
	private botConfig: BotConfig;
	public discordLogger?: DiscordLogger;
	public slackLogger?: SlackLogger;

	// Codes that are not sent to external sources (discord, slack)
	private externalExemptCodes: Array<number> = [4, 5, 6, 8];

	/**
	 *
	 */
	constructor(config: BotConfig) {
		this.botConfig = config;

		if (this.botConfig.discordWebhookUrl) {
			this.discordLogger = new DiscordLogger(this.botConfig.discordWebhookUrl);
		}

		if (this.botConfig.slackToken && this.botConfig.slackChannel) {
			this.slackLogger = new SlackLogger(this.botConfig.slackToken, this.botConfig.slackChannel);
		}
	}

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
