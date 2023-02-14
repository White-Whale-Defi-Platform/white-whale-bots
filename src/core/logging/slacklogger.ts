import { WebClient } from "@slack/web-api";

/**
 * Creates and returns a Slack WebClient using OAuth2 tokens.
 * @param token The token for OAuth2 authentication.
 */
export function getSlackClient(token: string) {
	return new WebClient(token);
}
/**
 * Sends the `message` to the Slack channel `channel` if `client` is not undefined. If
 * `client` is undefined, it will print `message` to stdout.
 * @param message The message to send to slack.
 * @param client The slack WebClient or undefined.
 * @param channel The slack Channel to send the message to or undefined.
 */
export async function sendSlackMessage(message: string, client: WebClient | undefined, channel: string | undefined) {
	if (client && channel) {
		// send log to slack channel
		await client.chat.postMessage({
			text: message,
			channel: channel,
		});
	} else {
		// log to stdout
		console.log(message);
	}
}
