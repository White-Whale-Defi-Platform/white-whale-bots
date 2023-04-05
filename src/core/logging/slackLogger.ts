import { WebClient } from "@slack/web-api";

/**
 *
 */
export class SlackLogger {
	public conversationId: string;
	public client: WebClient;

	/**
	 *
	 */
	constructor(token: string, channel: string) {
		this.client = new WebClient(token);
		this.conversationId = channel;
	}

	/**
	 * Sends the `message` to slack  if client is avaialble.
	 * @param message The message to send.
	 */
	async sendMessage(message: string) {
		if (this.client && this.conversationId.length > 0 && message) {
			await this.client.chat.postMessage({
				text: message,
				channel: this.conversationId,
			});
		}
	}
}
