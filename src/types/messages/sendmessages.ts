export type SendMessage = {
	send: {
		msg: string;
		amount: string;
		contract: string;
	};
};

/**
 * Checks if a send message is a send message.
 * @param msg The message object to be checked.
 * @return SendMessage if `msg` is one.
 */
export function isSendMessage(msg: any): msg is SendMessage {
	return msg["send" as keyof typeof msg] !== undefined;
}
