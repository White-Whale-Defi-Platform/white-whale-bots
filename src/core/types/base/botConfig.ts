import { StdFee } from "@cosmjs/stargate";
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

export interface BotConfig {
	chainPrefix: string;
	rpcUrls: Array<string>;
	grpcUrl: string;
	restUrl: string;
	useRpcUrlScraper: boolean;
	ignoreAddresses: IgnoredAddresses;
	poolEnvs: Array<{ pool: string; inputfee: number; outputfee: number; LPratio: number }>;
	maxPathPools: number;
	mappingFactoryRouter: Array<{ factory: string; router: string }>;
	flashloanRouterAddress: string;
	flashloanFee: number;
	offerAssetInfo: NativeAssetInfo;
	mnemonic: string;
	useMempool: boolean;
	timeoutDuration: number;
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
export async function setBotConfig(envs: NodeJS.ProcessEnv): Promise<BotConfig> {
	validateEnvs(envs);
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
	const GRPCURL = envs.GRPC_URL;
	const RESTURL = envs.REST_URL;
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
	const timeoutDuration = envs.TIMEOUT_DURATION === undefined ? 100 : Number(envs.TIMEOUT_DURATION);
	const IGNORE_ADDRS: IgnoredAddresses = {};
	// set ignored Addresses
	if (envs.IGNORE_ADDRESSES) {
		const addrs = JSON.parse(envs.IGNORE_ADDRESSES);
		addrs.forEach((element: string) => (IGNORE_ADDRS[element] = { timeoutAt: 0, duration: timeoutDuration }));
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
	const botConfig: BotConfig = {
		chainPrefix: envs.CHAIN_PREFIX,
		rpcUrls: RPCURLS,
		grpcUrl: GRPCURL,
		restUrl: RESTURL,
		useRpcUrlScraper: envs.USE_RPC_URL_SCRAPER == "1" ? true : false,
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
		timeoutDuration: timeoutDuration,
		skipConfig: skipConfig,
		loggerConfig: loggerConfig,
		signOfLife: SIGN_OF_LIFE,
		ignoreAddresses: IGNORE_ADDRS,
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
	assert(envs.FACTORIES_TO_ROUTERS_MAPPING, `Please set "FACTORIES_TO_ROUTERS_MAPPING" in env or ".env" file`);
	assert(envs.POOLS, `Please set "POOLS" in env or ".env" file`);
	assert(envs.FLASHLOAN_ROUTER_ADDRESS, `Please set "FLASHLOAN_ROUTER_ADDRESS" in env, or ".env" file`);
	assert(envs.GAS_DENOM, `Please set "GAS_DENOM" in env or ".env" file`);
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
