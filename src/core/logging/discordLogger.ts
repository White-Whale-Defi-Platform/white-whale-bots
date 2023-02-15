import { WebhookClient } from "discord.js";

/**
 *
 */
export class DiscordLogger {
	public client: WebhookClient;

	/**
	 *
	 */
	constructor(url: string) {
		this.client = new WebhookClient({ url: url });
	}

	/**
	 * Sends the `message` to the discord webhook if client is avaialble.
	 * @param message The message to send.
	 */
	async sendMessage(message: string) {
		if (this.client) {
			await this.client.send({
				content: message,
				username: "white-whale-bot",
				avatarURL: "https://whitewhale.money/favicon.png",
			});
		}
	}
}
