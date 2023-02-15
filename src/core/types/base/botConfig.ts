import { Coin, StdFee } from "@cosmjs/stargate";
import { assert } from "console";

import { NativeAssetInfo } from "./asset";

interface SkipConfig {
	useSkip: boolean;
	skipRpcUrl: string;
	skipBidWallet: string;
	skipBidRate: number;
}
export interface BotConfig {
	chainPrefix: string;
	rpcUrl: string;
	poolEnvs: Array<{ pool: string; inputfee: number; outputfee: number }>;
	maxPathPools: number;
	mappingFactoryRouter: Array<{ factory: string; router: string }>;
	flashloanRouterAddress: string;
	offerAssetInfo: NativeAssetInfo;
	mnemonic: string;
	useMempool: boolean;
	baseDenom: string;

	gasPrice: string;
	txFees: Map<number, StdFee>;
	profitThresholds: Map<number, number>;

	// logging specific (optionally)
	// Slack OAuth2 token for the specific SlackApp
	slackToken?: string | undefined;
	// channel the bot logs in to
	slackChannel?: string | undefined;
	// Discord webhook url
	discordWebhookUrl?: string | undefined;

	// Skip specific (optionally)
	skipConfig: SkipConfig | undefined;
}

/**
 *
 */
export function setBotConfig(envs: NodeJS.ProcessEnv): BotConfig {
	validateEnvs(envs);

	const POOLS_ENVS = envs.POOLS.split(",\n").map((pool) => JSON.parse(pool));
	const FACTORIES_TO_ROUTERS_MAPPING = envs.FACTORIES_TO_ROUTERS_MAPPING.split(",\n").map((mapping) =>
		JSON.parse(mapping),
	);
	const OFFER_ASSET_INFO: NativeAssetInfo = { native_token: { denom: envs.BASE_DENOM } };
	const GAS_UNIT_PRICE = envs.GAS_UNIT_PRICE; //price per gas unit in BASE_DENOM

	const GAS_USAGE_PER_HOP = +envs.GAS_USAGE_PER_HOP;
	const MAX_PATH_HOPS = +envs.MAX_PATH_HOPS; //required gas units per trade (hop)

	// setup skipconfig if present
	let skipConfig;
	if (envs.USE_SKIP == "1") {
		validateSkipEnvs(envs);
		skipConfig = {
			useSkip: true,
			skipRpcUrl: envs.SKIP_URL ?? "",
			skipBidWallet: envs.SKIP_BID_WALLET ?? "",
			skipBidRate: envs.SKIP_BID_RATE === undefined ? 0 : +envs.SKIP_BID_RATE,
		};
	}
	const FLASHLOAN_FEE = +envs.FLASHLOAN_FEE;
	const PROFIT_THRESHOLD = +envs.PROFIT_THRESHOLD;

	//set all required fees for the depth of the hops set by user;
	const GAS_FEES = new Map<number, Coin>();
	const TX_FEES = new Map<number, StdFee>();
	const PROFIT_THRESHOLDS = new Map<number, number>();
	for (let hops = 2; hops <= MAX_PATH_HOPS * 2; hops++) {
		const gasFee = { denom: envs.BASE_DENOM, amount: String(GAS_USAGE_PER_HOP * hops * +GAS_UNIT_PRICE) };
		GAS_FEES.set(hops, gasFee);
		TX_FEES.set(hops, { amount: [gasFee], gas: String(GAS_USAGE_PER_HOP * hops) });
		const profitThreshold: number =
			skipConfig === undefined
				? PROFIT_THRESHOLD / (1 - FLASHLOAN_FEE / 100) + +gasFee.amount //dont use skip bid on top of the threshold, include flashloan fee and gas fee
				: PROFIT_THRESHOLD / (1 - FLASHLOAN_FEE / 100) +
				  +gasFee.amount +
				  skipConfig.skipBidRate * PROFIT_THRESHOLD; //need extra profit to provide the skip bid
		PROFIT_THRESHOLDS.set(hops, profitThreshold);
	}
	const botConfig: BotConfig = {
		chainPrefix: envs.CHAIN_PREFIX,
		rpcUrl: envs.RPC_URL,
		poolEnvs: POOLS_ENVS,
		maxPathPools: MAX_PATH_HOPS,
		mappingFactoryRouter: FACTORIES_TO_ROUTERS_MAPPING,
		flashloanRouterAddress: envs.FLASHLOAN_ROUTER_ADDRESS,
		offerAssetInfo: OFFER_ASSET_INFO,
		mnemonic: envs.WALLET_MNEMONIC,
		useMempool: envs.USE_MEMPOOL == "1" ? true : false,
		baseDenom: envs.BASE_DENOM,
		gasPrice: envs.GAS_UNIT_PRICE,
		profitThresholds: PROFIT_THRESHOLDS,
		txFees: TX_FEES,
		slackToken: envs.SLACK_TOKEN,
		slackChannel: envs.SLACK_CHANNEL,
		discordWebhookUrl: envs.DISCORD_WEBHOOK_URL,
		skipConfig: skipConfig,
	};
	return botConfig;
}

/**
 *
 */
function validateEnvs(envs: NodeJS.ProcessEnv) {
	// validate env
	assert(envs.WALLET_MNEMONIC, `Please set "WALLET_MNEMONIC" in env, or ".env" file`);
	assert(envs.BASE_DENOM, `Please set "BASE_DENOM" in env or ".env" file`);
	assert(envs.CHAIN_PREFIX, `Please set "CHAIN_PREFIX" in env or ".env" file`);
	assert(envs.RPC_URL && envs.RPC_URL.includes("http"), `Please set "RPC_URL" in env or ".env" file`);
	assert(envs.FACTORIES_TO_ROUTERS_MAPPING, `Please set "FACTORIES_TO_ROUTERS_MAPPING" in env or ".env" file`);
	assert(envs.POOLS, `Please set "POOLS" in env or ".env" file`);
	assert(envs.FLASHLOAN_ROUTER_ADDRESS, `Please set "FLASHLOAN_ROUTER_ADDRESS" in env, or ".env" file`);
}

/**
 *
 */
function validateSkipEnvs(envs: NodeJS.ProcessEnv) {
	assert(envs.SKIP_URL, `Please set SKIP_URL in env or ".env" file`);
	assert(envs.SKIP_BID_WALLET, `Please set SKIP_BID_WALLET in env or ".env" file`);
	assert(envs.SKIP_BID_RATE, `Please set SKIP_BID_RATE in env or ".env" file`);
}
