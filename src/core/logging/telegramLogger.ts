import axios from "axios";
/**
 *
 */
export class TelegramLogger {
	private token: string;
	private chatId: string;

	/**
	 *
	 */
	constructor(token: string, chatId: string) {
		this.token = token;
		this.chatId = chatId;
	}

	/**
	 * Sends the `message` to the telegram chat if token and chatid supplied.
	 * @param message The message to send.
	 * @returns Boolean if successful.
	 */
	async sendMessage(message: string) {
		if (this.token && this.chatId) {
			try {
				const { status } = await axios.get(`https://api.telegram.org/bot${this.token}/sendMessage`, {
					params: { chat_id: this.chatId, text: message },
				});
				if (status === 200) {
					return true;
				} else {
					return false;
				}
			} catch (e: any) {
				console.log("error sending telegram message " + e.code);
				return false;
			}
		}
	}
}
