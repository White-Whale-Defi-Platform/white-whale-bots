declare namespace NodeJS {
	export interface ProcessEnv {
		/**
		 * The mnemonic associated with the wallet for performing arbitrage transactions.
		 */
		WALLET_MNEMONIC: string;

		/**
		 * The base denom to pay gas in.
		 *
		 * E.g., "uluna".
		 */
		BASE_DENOM: string;
		/**
		 * The BIP39 mnemonic for the wallet.
		 */
		CHAIN_PREFIX: string;
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
		/**.
		 * Minimum profit threshold, denominated as a multiplier on the paid gas fee in BASE_DENOM.
		 *
		 * Meaning minprofit = PROFIT_THRESHOL*paid_gas_fee_in_base_denom
		 *
		 */
		PROFIT_THRESHOLD: string;

		// only strings from the environment variables
		SIGN_OF_LIFE: string;

		GAS_USAGE_PER_HOP: string;
		MAX_PATH_HOPS: string;

		SLACK_TOKEN: string | undefined;
		SLACK_CHANNEL: string | undefined;
	}
}
