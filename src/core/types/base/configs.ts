import { StdFee } from "@cosmjs/stargate";
import axios from "axios";
import { assert } from "console";
import { DotenvParseOutput } from "dotenv";

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
export interface ChainConfig {
	flashloanRouterAddress: string;
	flashloanFee: number;
	offerAssetInfo: NativeAssetInfo;
	ignoreAddresses?: IgnoredAddresses;
	mappingFactoryRouter: Array<{ factory: string; router: string }>;
	poolEnvs: Array<{ pool: string; inputfee: number; outputfee: number; LPratio: number }>;
	orderbooks: Array<string>;
	baseDenom: string;
	chainPrefix: string;
	gasDenom: string;
	mnemonic: string;
	gasPrice: string;
	rpcUrls: Array<string>;
	grpcUrl?: string;
	restUrl?: string;
	txFees: Map<number, StdFee>;
	// Skip specific (optionally)
	skipConfig?: SkipConfig;
	profitThresholds: Map<number, number>;
	timeoutDuration: number;
}

export interface BotConfig {
	setupType: SetupType;
	signOfLife: number;
	loggerConfig: LoggerConfig;
	maxPathPools: number;
	useRpcUrlScraper: boolean;
	useMempool: boolean;
}

export interface LiquidationChainConfig extends ChainConfig {
	overseerAddresses: Array<string>;
}
/**
 *
 */
export async function setBotConfig(envs: DotenvParseOutput): Promise<BotConfig> {
	validateBotConfigEnvs(envs);
	const bc: BotConfig = await getBotConfig(envs);
	return bc;
}

/**
 *
 */
export async function setChainConfig(envs: DotenvParseOutput, bc: BotConfig): Promise<ChainConfig> {
	const chainConfig = await getChainConfig(envs, bc);
	if (bc.setupType === SetupType.LIQUIDATION) {
		return getLiquidationConfig(envs, chainConfig);
	} else {
		return chainConfig;
	}
}

/**
 *
 */
async function getBotConfig(envs: DotenvParseOutput): Promise<BotConfig> {
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
	return {
		setupType: setupType,
		loggerConfig: loggerConfig,
		signOfLife: SIGN_OF_LIFE,
		useMempool: envs.USE_MEMPOOL == "1" ? true : false,
		useRpcUrlScraper: envs.USE_RPC_URL_SCRAPER == "1" ? true : false,
		maxPathPools: envs.MAX_PATH_HOPS ? +envs.MAX_PATH_HOPS : 2,
	};
}
/**
 *
 */
function validateBotConfigEnvs(envs: DotenvParseOutput) {
	assert(envs.SETUP_TYPE, `Please set the "SETUP_TYPE" in the env or .env file`);
}
/**
 *
 */
function getLiquidationConfig(envs: DotenvParseOutput, chainConfig: ChainConfig): LiquidationChainConfig {
	validateLiquidationEnvs(envs);
	return { overseerAddresses: JSON.parse(envs.OVERSEER_ADDRESSES), ...chainConfig };
}
/**
 *
 */
async function getChainConfig(envs: DotenvParseOutput, botConfig: BotConfig): Promise<ChainConfig> {
	validateChainEnvs(envs);
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
	//Calculate tx fees and profit thresholds
	const PROFIT_THRESHOLD = +envs.PROFIT_THRESHOLD;
	const GAS_UNIT_PRICE = envs.GAS_UNIT_PRICE; //price per gas unit in BASE_DENOM
	const GAS_USAGE_PER_HOP = +envs.GAS_USAGE_PER_HOP;
	const MAX_PATH_HOPS = +envs.MAX_PATH_HOPS; //required gas units per trade (hop)
	//set all required fees for the depth of the hops set by user;
	const TX_FEES = new Map<number, StdFee>();
	const PROFIT_THRESHOLDS = new Map<number, number>();
	for (let hops = 2; hops <= (MAX_PATH_HOPS - 1) * 2 + 1; hops++) {
		if (envs.GAS_DENOM === "inj") {
			const gasFee = {
				denom: envs.GAS_DENOM,
				amount: (GAS_USAGE_PER_HOP * hops * +GAS_UNIT_PRICE * 1e12).toFixed(),
			};
			TX_FEES.set(hops, { amount: [gasFee], gas: String(GAS_USAGE_PER_HOP * hops) }); //in 6 decimals
		} else {
			const gasFee = { denom: envs.GAS_DENOM, amount: String(GAS_USAGE_PER_HOP * hops * +GAS_UNIT_PRICE) };
			TX_FEES.set(hops, { amount: [gasFee], gas: String(GAS_USAGE_PER_HOP * hops) }); //in 6 decimals
		}

		const profitThreshold: number = PROFIT_THRESHOLD + GAS_USAGE_PER_HOP * hops * +GAS_UNIT_PRICE; //in 6 decimal default
		PROFIT_THRESHOLDS.set(hops, profitThreshold);
	}
	return {
		baseDenom: envs.BASE_DENOM,
		chainPrefix: envs.CHAIN_PREFIX,
		gasDenom: envs.GAS_DENOM,
		gasPrice: envs.GAS_UNIT_PRICE,
		mnemonic: envs.WALLET_MNEMONIC,
		profitThresholds: PROFIT_THRESHOLDS,
		rpcUrls: RPCURLS,
		grpcUrl: envs.GRPC_URL,
		restUrl: envs.REST_URL,
		skipConfig: skipConfig,
		txFees: TX_FEES,
		flashloanRouterAddress: envs.FLASHLOAN_ROUTER_ADDRESS,
		flashloanFee: +envs.FLASHLOAN_FEE,
		ignoreAddresses: IGNORE_ADDRS,
		mappingFactoryRouter: FACTORIES_TO_ROUTERS_MAPPING,
		offerAssetInfo: OFFER_ASSET_INFO,
		poolEnvs: POOLS_ENVS,
		orderbooks: orderbooks ?? [],
		timeoutDuration: timeoutDuration,
	};
}

/**
 *
 */
function validateLiquidationEnvs(envs: DotenvParseOutput) {
	assert(envs.OVERSEER_ADDRESSES, `Please set the "OVERSEER_ADDRESSES" in the env or .env file`);
}

/**
 *
 */
function validateChainEnvs(envs: DotenvParseOutput) {
	assert(envs.WALLET_MNEMONIC, `Please set "WALLET_MNEMONIC" in env, or ".env" file`);
	assert(envs.BASE_DENOM, `Please set "BASE_DENOM" in env or ".env" file`);
	assert(envs.CHAIN_PREFIX, `Please set "CHAIN_PREFIX" in env or ".env" file`);
	assert(envs.GAS_DENOM, `Please set "GAS_DENOM" in env or ".env" file`);
	assert(envs.GAS_UNIT_PRICE, `Please set "GAS_DENOM" in env or ".env" file`);
	assert(envs.PROFIT_THRESHOLD, `Please set a "PROFIT_THRESHOLD" in the env or .env file`);
	assert(envs.RPC_URL, `Please set a "RPC_URL" in the env or .env file`);
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
function validateSkipEnvs(envs: DotenvParseOutput) {
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
