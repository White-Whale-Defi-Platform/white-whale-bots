import { assert } from "chai";
import dotenv from "dotenv";
import { describe } from "mocha";

import { TelegramLogger } from "../../../core/logging/telegramLogger";

// load env files
dotenv.config();
const testChatId = process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID : "";
const testToken = process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN : "";

describe("Test send successful Telegram Message", () => {
	it("Should return true after sending to chat", async () => {
		const logger = new TelegramLogger(testToken, testChatId);
		const status = await logger.sendMessage("test");
		assert.equal(status, true);
	});
});

describe("Test send Telegram Message with invalid data", () => {
	it("Should return false and print error message", async () => {
		const logger = new TelegramLogger("invalid", "00000");
		const status = await logger.sendMessage("test");
		assert.equal(status, false);
	});
});
