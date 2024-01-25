import axios from "axios";
import { assert } from "console";

import { NativeAssetInfo } from "./asset";
import { IgnoredAddresses } from "./mempool";

interface SkipConfig {
	useSkip: boolean;
	skipRpcUrl: string;
	skipBidWallet: string;
	skipBidRate: number;
	tryWithoutSkip: boolean;
}

interface LoggerConfig {
	slackToken?: string;
	slackChannel?: string;
	discordWebhookUrl?: string;
	telegramBotToken?: string;
	telegramChatId?: string;
	externalExemptCodes?: Array<number>;
}
export enum SetupType {
	DEX = "DEX",
	LIQUIDATION = "LIQUIDATION",
	IBC = "IBC",
}
export interface BaseConfig {
	baseDenom: string;
	chainPrefix: string;
	gasDenom: string;
	gasPrice: number;
	gasDenomToBaseRato: number;
	gasPerHop: number;
	profitThreshold: number;
	// Logger specific config.
	loggerConfig: LoggerConfig;
	mnemonic: string;
	rpcUrls: Array<string>;
	grpcUrl?: string;
	restUrl?: string;
	setupType: SetupType;
	signOfLife: number;
	// Skip specific (optionally)
	skipConfig?: SkipConfig;
	useMempool: boolean;
}

export interface DexConfig extends BaseConfig {
	flashloanRouterAddress: string;
	flashloanFee: number;

	ignoreAddresses?: IgnoredAddresses;
	maxPathPools: number;
	mappingFactoryRouter: Array<{ factory: string; router: string }>;
	offerAssetInfo: NativeAssetInfo;
	poolEnvs: Array<{ pool: string; inputfee: number; outputfee: number; LPratio: number }>;
	orderbooks: Array<string>;
	timeoutDuration: number;
	useRpcUrlScraper?: boolean;
}

export interface LiquidationConfig extends BaseConfig {
	overseerAddresses: Array<string>;
}

export type BotConfig = DexConfig | LiquidationConfig | BaseConfig;
/**
 *
 */
export async function setBotConfig(envs: NodeJS.ProcessEnv): Promise<BotConfig> {
	validateBaseEnvs(envs);
	const bc: BaseConfig = await getBaseConfig(envs);

	if (bc.setupType === SetupType.LIQUIDATION) {
		validateLiquidationEnvs(envs);
		const botConfig: LiquidationConfig = getLiquidationConfig(envs, bc);
		return botConfig;
	} else if (bc.setupType === SetupType.DEX) {
		validateDexEnvs(envs);
		const botConfig: DexConfig = getDexConfig(envs, bc);
		return botConfig;
		//do something
	} else if (bc.setupType === SetupType.IBC) {
		return bc;
		//do something
	} else {
		return bc;
	}
}

/**
 *
 */
async function getBaseConfig(envs: NodeJS.ProcessEnv): Promise<BaseConfig> {
	console.log(envs);
	let setupType: SetupType;
	switch (envs.SETUP_TYPE.toLocaleLowerCase()) {
		case "dex":
			setupType = SetupType.DEX;
			break;
		case "liquidation":
			setupType = SetupType.LIQUIDATION;
			break;
		case "ibc":
			setupType = SetupType.IBC;
			break;
		default:
			console.error("Please set the SETUP_TYPE in the env file");
			process.exit(1);
	}

	let RPCURLS: Array<string>;
	if (envs.RPC_URL && envs.USE_RPC_URL_SCRAPER == "1") {
		const RPCURLS_PROVIDED = envs.RPC_URL.startsWith("[") ? JSON.parse(envs.RPC_URL) : [envs.RPC_URL];
		RPCURLS = await getRPCfromRegistry(envs.CHAIN_PREFIX, RPCURLS_PROVIDED);
	} else if (!envs.RPC_URL && envs.USE_RPC_URL_SCRAPER == "1") {
		RPCURLS = await getRPCfromRegistry(envs.CHAIN_PREFIX);
	} else if (envs.RPC_URL) {
		RPCURLS = envs.RPC_URL.startsWith("[") ? JSON.parse(envs.RPC_URL) : [envs.RPC_URL];
	} else {
		console.log("no RPC URL provided or USE_RPC_URL_SCRAPER not set correctly");
		process.exit(1);
	}

	// setup skipconfig if present
	let skipConfig;
	if (envs.USE_SKIP == "1") {
		validateSkipEnvs(envs);
		skipConfig = {
			useSkip: true,
			skipRpcUrl: envs.SKIP_URL ?? "",
			skipBidWallet: envs.SKIP_BID_WALLET ?? "",
			skipBidRate: envs.SKIP_BID_RATE === undefined ? 0 : +envs.SKIP_BID_RATE,
			tryWithoutSkip: envs.TRY_WITHOUT_SKIP === "1" ? true : false,
		};
	}

	// setup logger config.
	const SIGN_OF_LIFE = Number(envs.SIGN_OF_LIFE === undefined ? 30 : +envs.SIGN_OF_LIFE);
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

	//Calculate tx fees and profit thresholds
	const PROFIT_THRESHOLD = +envs.PROFIT_THRESHOLD;
	const GAS_UNIT_PRICE = +envs.GAS_UNIT_PRICE; //price per gas unit in BASE_DENOM
	const GAS_USAGE_PER_HOP = +envs.GAS_USAGE_PER_HOP;
	const GAS_TO_BASE_RATIO = +envs.GAS_TO_BASE_RATIO ?? 1;

	return {
		setupType: setupType,
		baseDenom: envs.BASE_DENOM,
		chainPrefix: envs.CHAIN_PREFIX,
		gasDenom: envs.GAS_DENOM,
		gasPrice: GAS_UNIT_PRICE,
		gasDenomToBaseRato: GAS_TO_BASE_RATIO,
		gasPerHop: GAS_USAGE_PER_HOP,
		profitThreshold: PROFIT_THRESHOLD,
		loggerConfig: loggerConfig,
		mnemonic: envs.WALLET_MNEMONIC,
		rpcUrls: RPCURLS,
		grpcUrl: envs.GRPC_URL,
		restUrl: envs.REST_URL,
		signOfLife: SIGN_OF_LIFE,
		skipConfig: skipConfig,
		useMempool: envs.USE_MEMPOOL == "1" ? true : false,
	};
}
/**
 *
 */
function getLiquidationConfig(envs: NodeJS.ProcessEnv, baseConfig: BaseConfig): LiquidationConfig {
	return { overseerAddresses: JSON.parse(envs.OVERSEER_ADDRESSES), ...baseConfig };
}
/**
 *
 */
function getDexConfig(envs: NodeJS.ProcessEnv, baseConfig: BaseConfig): DexConfig {
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

	const OFFER_ASSET_INFO: NativeAssetInfo = { native_token: { denom: envs.BASE_DENOM } };

	const IGNORE_ADDRS: IgnoredAddresses = {};
	const timeoutDuration = envs.TIMEOUT_DURATION === undefined ? 100 : Number(envs.TIMEOUT_DURATION);
	// set ignored Addresses
	if (envs.IGNORE_ADDRESSES) {
		const addrs = JSON.parse(envs.IGNORE_ADDRESSES);
		addrs.forEach((element: string) => (IGNORE_ADDRS[element] = { timeoutAt: 0, duration: timeoutDuration }));
	}
	let orderbooks;
	if (envs.ORDERBOOKS) {
		orderbooks = JSON.parse(envs.ORDERBOOKS);
	}

	return {
		...baseConfig,
		flashloanRouterAddress: envs.FLASHLOAN_ROUTER_ADDRESS,
		flashloanFee: +envs.FLASHLOAN_FEE,
		ignoreAddresses: IGNORE_ADDRS,
		maxPathPools: +envs.MAX_PATH_HOPS,
		mappingFactoryRouter: FACTORIES_TO_ROUTERS_MAPPING,
		offerAssetInfo: OFFER_ASSET_INFO,
		poolEnvs: POOLS_ENVS,
		orderbooks: orderbooks ?? [],
		timeoutDuration: timeoutDuration,
		useRpcUrlScraper: envs.USE_RPC_URL_SCRAPER == "1" ? true : false,
	};
}
/**
 *
 */
function validateBaseEnvs(envs: NodeJS.ProcessEnv) {
	assert(envs.SETUP_TYPE, `Please set the "SETUP_TYPE" in the env or .env file`);
	assert(envs.WALLET_MNEMONIC, `Please set "WALLET_MNEMONIC" in env, or ".env" file`);
	assert(envs.BASE_DENOM, `Please set "BASE_DENOM" in env or ".env" file`);
	assert(envs.CHAIN_PREFIX, `Please set "CHAIN_PREFIX" in env or ".env" file`);
	assert(envs.GAS_DENOM, `Please set "GAS_DENOM" in env or ".env" file`);
	assert(envs.GAS_UNIT_PRICE, `Please set "GAS_DENOM" in env or ".env" file`);
	assert(envs.PROFIT_THRESHOLD, `Please set a "PROFIT_THRESHOLD" in the env or .env file`);
	assert(envs.RPC_URL, `Please set a "RPC_URL" in the env or .env file`);
}
/**
 *
 */
function validateLiquidationEnvs(envs: NodeJS.ProcessEnv) {
	assert(envs.OVERSEER_ADDRESSES, `Please set the "OVERSEER_ADDRESSES" in the env or .env file`);
}

/**
 *
 */
function validateDexEnvs(envs: NodeJS.ProcessEnv) {
	assert(envs.FLASHLOAN_ROUTER_ADDRESS, `Please set the "FLASHLOAN_ROUTER_ADDRESS" in the env or .env file`);
	assert(envs.FLASHLOAN_FEE, `Please set the "FLASHLOAN_FEE" in the env or .env file`);
	assert(envs.MAX_PATH_HOPS, `Please set the "MAX_PATH_HOPS" in the env or .env file`);
	assert(envs.USE_RPC_URL_SCRAPER, `Please set the "USE_RPC_URL_SCRAPER" in the env or .env file`);
	assert(envs.POOLS, `Please set the "POOLS" in the env or .env file`);
	assert(envs.FACTORIES_TO_ROUTERS_MAPPING, `Please set the "FACTORIES_TO_ROUTERS_MAPPING" in the env or .env file`);
}
/**
 *
 */
function validateSkipEnvs(envs: NodeJS.ProcessEnv) {
	assert(envs.SKIP_URL, `Please set SKIP_URL in env or ".env" file`);
	assert(envs.SKIP_BID_WALLET, `Please set SKIP_BID_WALLET in env or ".env" file`);
	assert(envs.SKIP_BID_RATE, `Please set SKIP_BID_RATE in env or ".env" file`);
}

/**
 *
 */
function randomize(values: Array<string>) {
	let index = values.length,
		randomIndex;

	// While there remain elements to shuffle.
	while (index != 0) {
		// Pick a remaining element.
		randomIndex = Math.floor(Math.random() * index);
		index--;

		// And swap it with the current element.
		[values[index], values[randomIndex]] = [values[randomIndex], values[index]];
	}

	return values;
}

/**
 *
 */
async function getRPCfromRegistry(prefix: string, inputurls?: Array<string>) {
	const registry = await axios.get(`https://api.github.com/repos/cosmos/chain-registry/contents/`);
	let path = "";
	registry.data.forEach((elem: any) => {
		if (elem.name.includes(prefix)) {
			path = elem.path;
		}
	});
	const chaindata = await axios.get(
		`https://raw.githubusercontent.com/cosmos/chain-registry/master/${path}/chain.json`,
	);
	const rpcs = randomize(chaindata.data.apis.rpc);
	let out: Array<string>;
	if (!inputurls) {
		out = new Array<string>();
	} else {
		out = inputurls;
	}

	rpcs.forEach((element: any) => {
		if (!out.includes(element.address)) {
			out.push(element.address);
		}
	});
	return out;
}
