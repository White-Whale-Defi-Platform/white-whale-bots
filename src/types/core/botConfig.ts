import { Coin, StdFee } from "@cosmjs/stargate";
import { assert } from "console";

import { NativeAssetInfo } from "./asset";

export interface BotConfig {
	chainPrefix: string;
	rpcUrl: string;
	poolEnvs: Array<{ pool: string; inputfee: number; outputfee: number }>;
	mappingFactoryRouter: Array<{ factory: string; router: string }>;
	flashloanRouterAddress: string;
	offerAssetInfo: NativeAssetInfo;
	mnemonic: string;
	useMempool: boolean;
	baseDenom: string;

	gasPrice: string;
	profitThreshold3Hop: number;
	profitThreshold2Hop: number;
	txFee3Hop: StdFee;
	txFee2Hop: StdFee;

	// logging specific (optionally)
	// Slack OAuth2 token for the specific SlackApp
	slackToken?: string | undefined;
	// channel the bot logs in to
	slackChannel?: string | undefined;

	// Skip specific (optionally)
	useSkip?: boolean;
	skipRpcUrl?: string | undefined;
	skipBidWallet?: string | undefined;
	skipBidRate?: number | undefined;
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

	const GAS_UNIT_USAGES = envs.GAS_UNIT_USAGES.split(",");
	const GAS_UNIT_PRICE = envs.GAS_UNIT_PRICE; //price per gas unit in BASE_DENOM
	const GAS_FEE_2HOP: Coin = { denom: envs.BASE_DENOM, amount: String(+GAS_UNIT_USAGES[0] * +GAS_UNIT_PRICE) };
	const GAS_FEE_3HOP: Coin = { denom: envs.BASE_DENOM, amount: String(+GAS_UNIT_USAGES[1] * +GAS_UNIT_PRICE) };
	const TX_FEE_2HOP: StdFee = { amount: [GAS_FEE_2HOP], gas: GAS_UNIT_USAGES[0] };
	const TX_FEE_3HOP: StdFee = { amount: [GAS_FEE_3HOP], gas: GAS_UNIT_USAGES[1] };

	//make sure amount is GAS_FEE.gas * GAS_PRICE at minimum
	//make sure gas units used is adjusted based on amount of msgs in the arb
	//make sure amount is GAS_FEE.gas * GAS_PRICE at minimum
	//make sure gas units used is adjusted based on amount of msgs in the arb
	const MIN_PROFIT_THRESHOLD3Hop = +envs.PROFIT_THRESHOLD * +GAS_FEE_3HOP.amount; //minimal profit threshold as multiplier of paid GAS_COIN.amount
	const MIN_PROFIT_THRESHOLD2Hop = +envs.PROFIT_THRESHOLD * +GAS_FEE_2HOP.amount; //minimal profit threshold as multiplier of paid GAS_COIN.amount

	const SKIP_BID_RATE = envs.SKIP_BID_RATE !== undefined ? +envs.SKIP_BID_RATE : undefined;
	const botConfig: BotConfig = {
		chainPrefix: envs.CHAIN_PREFIX,
		rpcUrl: envs.RPC_URL,
		poolEnvs: POOLS_ENVS,
		mappingFactoryRouter: FACTORIES_TO_ROUTERS_MAPPING,
		flashloanRouterAddress: envs.FLASHLOAN_ROUTER_ADDRESS,
		offerAssetInfo: OFFER_ASSET_INFO,
		mnemonic: envs.WALLET_MNEMONIC,
		useMempool: envs.USE_MEMPOOL == "1" ? true : false,
		baseDenom: envs.BASE_DENOM,
		gasPrice: envs.GAS_UNIT_PRICE,
		profitThreshold3Hop: MIN_PROFIT_THRESHOLD3Hop,
		profitThreshold2Hop: MIN_PROFIT_THRESHOLD2Hop,
		txFee3Hop: TX_FEE_3HOP,
		txFee2Hop: TX_FEE_2HOP,
		slackToken: envs.SLACK_TOKEN,
		slackChannel: envs.SLACK_CHANNEL,
		useSkip: envs.USE_SKIP == "1" ? true : false,
		skipRpcUrl: envs.SKIP_URL,
		skipBidWallet: envs.SKIP_BID_WALLET,
		skipBidRate: SKIP_BID_RATE,
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
 * Runs the main program.
 */
