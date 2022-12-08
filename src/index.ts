import { Coin, GasPrice, StdFee } from "@cosmjs/stargate";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { assert } from "console";
import dotenv from "dotenv";

import { trySomeArb } from "./arbitrage/arbitrage";
import * as Juno from "./juno/juno";
import { getSlackClient, sendSlackMessage } from "./logging/slacklogger";
import { getChainOperator } from "./node/chainoperator";
import * as Terra from "./terra/terra";
import { MempoolLoop } from "./types/arbitrage/mempoolLoop";
import { NativeAssetInfo } from "./types/core/asset";
import { getPathsFromPool, getPathsFromPools3Hop } from "./types/core/path";
// load env files
dotenv.config();

// validate env
assert(process.env.WALLET_MNEMONIC, `Please set "WALLET_MNEMONIC" in env, or ".env" file`);
assert(process.env.BASE_DENOM, `Please set "BASE_DENOM" in env or ".env" file`);
assert(process.env.CHAIN_PREFIX, `Please set "CHAIN_PREFIX" in env or ".env" file`);
assert(process.env.RPC_URL && process.env.RPC_URL.includes("http"), `Please set "RPC_URL" in env or ".env" file`);
assert(process.env.FACTORIES_TO_ROUTERS_MAPPING, `Please set "FACTORIES_TO_ROUTERS_MAPPING" in env or ".env" file`);
assert(process.env.POOLS, `Please set "POOLS" in env or ".env" file`);

/**
 * Runs the main program.
 */
const POOLS_ENVS = process.env.POOLS.split(",\n").map((pool) => JSON.parse(pool));
const POOL_ADDRESSES = POOLS_ENVS.map((pool) => {
	return pool.pool;
});
const FACTORIES_TO_ROUTERS_MAPPING = process.env.FACTORIES_TO_ROUTERS_MAPPING.split(",\n").map((mapping) =>
	JSON.parse(mapping),
);
const OFFER_ASSET_DENOM = process.env.BASE_DENOM;
const OFFER_ASSET_INFO: NativeAssetInfo = { native_token: { denom: OFFER_ASSET_DENOM } };
const WEBSOCKET_ENDPOINT = process.env.RPC_URL.replace("http://", "ws://").replace("https://", "wss://");
const MNEMONIC = process.env.WALLET_MNEMONIC;

const GAS_UNIT_PRICE = process.env.GAS_UNIT_PRICE; //price per gas unit in BASE_DENOM
const GAS_PRICE = GasPrice.fromString(GAS_UNIT_PRICE + OFFER_ASSET_DENOM); //gas price per gas unit
const GAS_UNIT_USAGES = process.env.GAS_UNIT_USAGES.split(",");
const GAS_FEE_2HOP: Coin = { denom: OFFER_ASSET_DENOM, amount: String(+GAS_UNIT_USAGES[0] * +GAS_UNIT_PRICE) };
const GAS_FEE_3HOP: Coin = { denom: OFFER_ASSET_DENOM, amount: String(+GAS_UNIT_USAGES[1] * +GAS_UNIT_PRICE) };
const TX_FEE_2HOP: StdFee = { amount: [GAS_FEE_2HOP], gas: GAS_UNIT_USAGES[0] };
const TX_FEE_3HOP: StdFee = { amount: [GAS_FEE_3HOP], gas: GAS_UNIT_USAGES[1] };
const USE_MEMPOOL = process.env.USE_MEMPOOL == "1" ? true : false;

//make sure amount is GAS_FEE.gas * GAS_PRICE at minimum
//make sure gas units used is adjusted based on amount of msgs in the arb
//make sure amount is GAS_FEE.gas * GAS_PRICE at minimum
//make sure gas units used is adjusted based on amount of msgs in the arb
const MIN_PROFIT_THRESHOLD3Hop = +process.env.PROFIT_THRESHOLD * +GAS_FEE_3HOP.amount; //minimal profit threshold as multiplier of paid GAS_COIN.amount
const MIN_PROFIT_THRESHOLD2Hop = +process.env.PROFIT_THRESHOLD * +GAS_FEE_2HOP.amount; //minimal profit threshold as multiplier of paid GAS_COIN.amount

const SLACK_TOKEN = process.env.SLACK_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;
let getFlashArbMessages = Juno.getFlashArbMessages;
let getPoolStates = Juno.getPoolStates;
let initPools = Juno.initPools;
switch (process.env.CHAIN_PREFIX) {
	case "terra": {
		getFlashArbMessages = Terra.getFlashArbMessages;
		getPoolStates = Terra.getPoolStates;
		initPools = Terra.initPools;
	}
}

console.log("---".repeat(30));
console.log("Environmental variables for setup:");
console.log("RPC ENPDOINT: ", process.env.RPC_URL);
console.log("WEBSOCKET (derived from RPC ENDPOINT): ", WEBSOCKET_ENDPOINT);
console.log("OFFER DENOM: ", OFFER_ASSET_DENOM);
console.log("POOLS: ", POOL_ADDRESSES);
console.log("FACTORIES_TO_ROUTERS_MAPPING", FACTORIES_TO_ROUTERS_MAPPING);
console.log("USE MEMPOOL: ", USE_MEMPOOL);
console.log("---".repeat(30));

/**
 * Runs the main program.
 */
async function main() {
	console.log("Setting up connections and paths");
	const [account, botClients] = await getChainOperator(
		process.env.RPC_URL,
		MNEMONIC,
		process.env.CHAIN_PREFIX,
		GAS_PRICE,
	);
	let slackClient;
	if (SLACK_TOKEN) {
		slackClient = getSlackClient(SLACK_TOKEN);
	}

	const { accountNumber, sequence } = await botClients.SigningCWClient.getSequence(account.address);
	const chainId = await (
		await botClients.HttpClient.execute(createJsonRpcRequest("block"))
	).result.block.header.chain_id;
	console.log("accountnumber: ", accountNumber, " sequence: ", sequence, "chainid: ", chainId);
	console.log("Done, Clients established");
	console.log("---".repeat(30));
	console.log("Deriving paths for arbitrage");
	const pools = await initPools(botClients.WasmQueryClient, POOLS_ENVS, FACTORIES_TO_ROUTERS_MAPPING);
	const paths = getPathsFromPool(pools, OFFER_ASSET_INFO);
	const paths2 = getPathsFromPools3Hop(pools, OFFER_ASSET_INFO);
	console.log("2 HOP paths: ", paths.length);
	console.log("3 HOP paths: ", paths2.length);
	paths.push(...paths2);
	console.log("total paths: ", paths.length);
	console.log("---".repeat(30));

	const mempoolLoop = new MempoolLoop(
		pools,
		paths,
		trySomeArb,
		getPoolStates,
		getFlashArbMessages,
		botClients,
		account,
		OFFER_ASSET_INFO,
		[MIN_PROFIT_THRESHOLD2Hop, MIN_PROFIT_THRESHOLD3Hop],
	);
	// main loop of the bot
	await mempoolLoop.fetchRequiredChainData();
	mempoolLoop.setGasFees([TX_FEE_2HOP, TX_FEE_3HOP]);

	while (true) {
		await mempoolLoop.step();
		mempoolLoop.reset();
		if (mempoolLoop.iterations % 150 === 0) {
			await sendSlackMessage(
				"wallet: " + account.address + " sign of life, bot is running",
				slackClient,
				SLACK_CHANNEL,
			);
		}
	}
}

main().catch(console.log);
