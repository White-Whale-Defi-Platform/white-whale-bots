declare namespace NodeJS {
	export interface ProcessEnv {
		/**
		 * The mnemonic associated with the wallet for performing arbitrage transactions.
		 */
		WALLET_MNEMONIC: string;

		/**
		 * The base denom to start the arb from.
		 *
		 * E.g., "uluna".
		 */
		BASE_DENOM: string;
		/**
		 * The BIP39 mnemonic for the wallet.
		 */
		CHAIN_PREFIX: string;
		/**
		 * The denom to pay gas in. Also used for skip bidding.
		 *
		 * E.g., "uluna".
		 */
		GAS_DENOM: string;
		/**
		 * The http endpoint to the RPC.
		 */

		RPC_URL: string;
		/**
		 * A list of all the factories to map, separated by ", \n".
		 *
		 * Stored as a JSON object containing a "factory" and "router" key/value pair.
		 */
		FACTORIES_TO_ROUTERS_MAPPING: string;
		/**
		 * Flashloan router contract that handles the flashloan and execute the operations/messages.
		 */
		FLASHLOAN_ROUTER_ADDRESS: string;
		/**
		 * Fee used for taking a flashloan.
		 */
		FLASHLOAN_FEE: string;
		/**
		 * A list of all the pools to map, separated by ", \n".
		 *
		 * Stored as a JSON object containing a "pool" and "fee" key/value pair.
		 *
		 * The "fee" value should be a numeric specifying how much ofo the BASE_DENOM to pay.
		 */
		POOLS: string;
		/**
		 * Set to "1" if the code should use mempool analysis to send transactions.
		 *
		 * This will decrease success rate but increase throughput.
		 */
		USE_MEMPOOL: string;
		/**
		 * The price of a GAS_UNIT on the specific chain, denominated by BASE_DENOM.
		 */
		GAS_UNIT_PRICE: string;
		/**
		 * Minimum profit threshold, denominated as a multiplier on the paid gas fee in BASE_DENOM.
		 *
		 * Meaning minprofit = PROFIT_THRESHOL*paid_gas_fee_in_base_denom.
		 *
		 */
		PROFIT_THRESHOLD: string;
		/**
		 * Sends Sign of life message every x minutes.
		 */
		SIGN_OF_LIFE: string;
		/**
		 * Gas usage per hop.
		 * Hop = Number of pools that must be used to achieve the arbitrage.
		 */
		GAS_USAGE_PER_HOP: string;
		/**
		 * Max hops the bot should calculate trades for.
		 */
		MAX_PATH_HOPS: string;
		/**
		 * Slack bot token.
		 */
		SLACK_TOKEN: string | undefined;
		/**
		 * Name of slack channel.
		 */
		SLACK_CHANNEL: string | undefined;
		/**
		 * Discord Webhook to send logs to.
		 */
		DISCORD_WEBHOOK_URL: string | undefined;
		/**
		 * Telegram bot token.
		 */
		TELEGRAM_BOT_TOKEN: string | undefined;
		/**
		 * Telegram chat id.
		 */
		TELEGRAM_CHAT_ID: string | undefined;
		/**
		 * Codes that are not sent to external sources (discord, slack).
		 */
		EXTERNAL_EXEMPT_CODES: string | undefined;
		/**
		 * Denotes whether we use skip for submitting transaction bundles.
		 */
		USE_SKIP: string | undefined;
		/**
		 * The skip url to send transactions to.
		 */
		SKIP_URL: string | undefined;
		/**
		 * The auction house wallet that skip uses on this chain.
		 */
		SKIP_BID_WALLET: string | undefined;
		/**
		 * The ratio of the profit to send as a bid.
		 */
		SKIP_BID_RATE: string | undefined;
	}
}
