import { StdFee } from "@cosmjs/stargate";
import { getStdFee } from "@injectivelabs/utils";
import { assert } from "console";

import { NativeAssetInfo } from "./asset";

interface SkipConfig {
	useSkip: boolean;
	skipRpcUrl: string;
	skipBidWallet: string;
	skipBidRate: number;
}

interface LoggerConfig {
	slackToken?: string;
	slackChannel?: string;
	discordWebhookUrl?: string;
	telegramBotToken?: string;
	telegramChatId?: string;
	externalExemptCodes?: Array<number>;
}

export interface BotConfig {
	chainPrefix: string;
	rpcUrl: string;
	poolEnvs: Array<{ pool: string; inputfee: number; outputfee: number; LPratio: number }>;
	maxPathPools: number;
	mappingFactoryRouter: Array<{ factory: string; router: string }>;
	flashloanRouterAddress: string;
	flashloanFee: number;
	offerAssetInfo: NativeAssetInfo;
	mnemonic: string;
	useMempool: boolean;
	baseDenom: string;
	gasDenom: string;
	signOfLife: number;

	gasPrice: string;
	txFees: Map<number, StdFee>;
	profitThresholds: Map<number, number>;

	// Logger specific config.
	loggerConfig: LoggerConfig;

	// Skip specific (optionally)
	skipConfig: SkipConfig | undefined;
}

/**
 *
 */
export function setBotConfig(envs: NodeJS.ProcessEnv): BotConfig {
	validateEnvs(envs);

	let pools = envs.POOLS.trim()
		.replace(/\n|\r|\t/g, "")
		.replace(/,\s*$/, "");
	pools = pools.startsWith("[") && pools.endsWith("]") ? pools : `[${pools}]`;
	const POOLS_ENVS = JSON.parse(pools);

	let factories = envs.FACTORIES_TO_ROUTERS_MAPPING.trim()
		.replace(/\n|\r|\t/g, "")
		.replace(/,\s*$/, "");
	factories = factories.startsWith("[") && factories.endsWith("]") ? factories : `[${factories}]`;
	const FACTORIES_TO_ROUTERS_MAPPING = JSON.parse(factories);

	const SIGN_OF_LIFE = Number(envs.SIGN_OF_LIFE === undefined ? 30 : +envs.SIGN_OF_LIFE);
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

	// setup logger config.
	const externalExemptCodesStr = envs.EXTERNAL_EXEMPT_CODES?.split(",") ?? [];
	const externalExemptCodes = externalExemptCodesStr.map((el) => {
		return parseInt(el);
	});
	const loggerConfig: LoggerConfig = {
		slackChannel: envs.SLACK_CHANNEL,
		slackToken: envs.SLACK_TOKEN,
		discordWebhookUrl: envs.DISCORD_WEBHOOK_URL,
		telegramBotToken: envs.TELEGRAM_BOT_TOKEN,
		telegramChatId: envs.TELEGRAM_CHAT_ID,
		externalExemptCodes: externalExemptCodes,
	};

	const PROFIT_THRESHOLD = +envs.PROFIT_THRESHOLD;

	//set all required fees for the depth of the hops set by user;
	const TX_FEES = new Map<number, StdFee>();
	const PROFIT_THRESHOLDS = new Map<number, number>();
	for (let hops = 2; hops <= (MAX_PATH_HOPS - 1) * 2 + 1; hops++) {
		if (envs.GAS_DENOM === "inj") {
			TX_FEES.set(hops, getStdFee(String(GAS_USAGE_PER_HOP * hops))); //in 18 decimals
		} else {
			const gasFee = { denom: envs.GAS_DENOM, amount: String(GAS_USAGE_PER_HOP * hops * +GAS_UNIT_PRICE) };
			TX_FEES.set(hops, { amount: [gasFee], gas: String(GAS_USAGE_PER_HOP * hops) }); //in 6 decimals
		}

		const profitThreshold: number = PROFIT_THRESHOLD + GAS_USAGE_PER_HOP * hops * +GAS_UNIT_PRICE; //in 6 decimal default
		PROFIT_THRESHOLDS.set(hops, profitThreshold);
	}
	const botConfig: BotConfig = {
		chainPrefix: envs.CHAIN_PREFIX,
		rpcUrl: envs.RPC_URL,
		poolEnvs: POOLS_ENVS,
		maxPathPools: MAX_PATH_HOPS,
		mappingFactoryRouter: FACTORIES_TO_ROUTERS_MAPPING,
		flashloanRouterAddress: envs.FLASHLOAN_ROUTER_ADDRESS,
		flashloanFee: +envs.FLASHLOAN_FEE,
		offerAssetInfo: OFFER_ASSET_INFO,
		mnemonic: envs.WALLET_MNEMONIC,
		useMempool: envs.USE_MEMPOOL == "1" ? true : false,
		baseDenom: envs.BASE_DENOM,
		gasDenom: envs.GAS_DENOM,
		gasPrice: envs.GAS_UNIT_PRICE,
		profitThresholds: PROFIT_THRESHOLDS,
		txFees: TX_FEES,
		skipConfig: skipConfig,
		loggerConfig: loggerConfig,
		signOfLife: SIGN_OF_LIFE,
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
