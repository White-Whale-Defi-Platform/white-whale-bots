import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import dotenv from "dotenv";

import * as chains from "./chains";
import { trySomeArb } from "./core/arbitrage/arbitrage";
import { getSlackClient, sendSlackMessage } from "./core/logging/slacklogger";
import { getChainOperator } from "./core/node/chainoperator";
import { getSkipClient } from "./core/node/skipclients";
import { MempoolLoop } from "./core/types/arbitrageloops/mempoolLoop";
import { SkipLoop } from "./core/types/arbitrageloops/skipLoop";
import { setBotConfig } from "./core/types/base/botConfig";
import { getPathsFromPool, getPathsFromPools3Hop } from "./core/types/base/path";
import { removedUnusedPools } from "./core/types/base/pool";
// load env files
dotenv.config();
const botConfig = setBotConfig(process.env);

console.log("---".repeat(30));
console.log("Environmental variables for setup:");
console.log("RPC ENPDOINT: ", botConfig.rpcUrl);
console.log("OFFER DENOM: ", botConfig.offerAssetInfo);
// console.log("POOLS: ", botConfig.poolEnvs);
console.log("FACTORIES_TO_ROUTERS_MAPPING", botConfig.mappingFactoryRouter);
console.log("USE MEMPOOL: ", botConfig.useMempool);

if (botConfig.skipConfig) {
	console.log("USE SKIP: ", botConfig.skipConfig.useSkip);
	console.log("SKIP URL: ", botConfig.skipConfig.skipRpcUrl);
}
console.log("---".repeat(30));

/**
 * Runs the main program.
 */
async function main() {
	const timeouturls = new Map<string,number>;
	const errorpaths = new Map<string,number>;
	let getFlashArbMessages = chains.defaults.getFlashArbMessages;
	let getPoolStates = chains.defaults.getPoolStates;
	let initPools = chains.defaults.initPools;
	await import("./chains/" + botConfig.chainPrefix).then((chainSetups) => {
		if (chainSetups === undefined) {
			console.log("Unable to resolve specific chain imports, using defaults");
		}
		getFlashArbMessages = chainSetups.getFlashArbMessages;
		getPoolStates = chainSetups.getPoolStates;
		initPools = chainSetups.initPools;
		return;
	});
	console.log("Setting up connections and paths");
	const [account, botClients] = await getChainOperator(botConfig, botConfig.rpcUrl[0]);
	let slackClient;
	if (botConfig.slackToken) {
		slackClient = getSlackClient(botConfig.slackToken);
	}
	console.log(botConfig);
	const { accountNumber, sequence } = await botClients.SigningCWClient.getSequence(account.address);
	const chainId = await (
		await botClients.HttpClient.execute(createJsonRpcRequest("block"))
	).result.block.header.chain_id;
	console.log("accountnumber: ", accountNumber, " sequence: ", sequence, "chainid: ", chainId);
	console.log("Done, Clients established");
	console.log("---".repeat(30));
	console.log("Deriving paths for arbitrage");
	const allPools = await initPools(botClients, botConfig.poolEnvs, botConfig.mappingFactoryRouter);

	const paths = getPathsFromPool(allPools, botConfig.offerAssetInfo);
	const paths2 = getPathsFromPools3Hop(allPools, botConfig.offerAssetInfo);
	console.log("2 HOP paths: ", paths.length);
	console.log("3 HOP paths: ", paths2.length);
	paths.push(...paths2);
	console.log("total paths: ", paths.length);
	console.log("---".repeat(30));
	const filteredPools = removedUnusedPools(allPools, paths);
	console.log("Removed ", allPools.length - filteredPools.length, " unused pools");

	let loop;
	if (botConfig.skipConfig) {
		console.log("Initializing skip loop");
		const [skipClient, skipSigner] = await getSkipClient(
			botConfig.skipConfig.skipRpcUrl,
			botConfig.mnemonic,
			botConfig.chainPrefix,
		);
		loop = new SkipLoop(
			filteredPools,
			paths,
			trySomeArb,
			getPoolStates,
			getFlashArbMessages,
			botClients,
			account,
			botConfig,
			skipClient,
			skipSigner,
			slackClient,
			timeouturls,
			errorpaths,
		);
	} else if (botConfig.useMempool === true) {
		console.log("Initializing mempool loop");
		loop = new MempoolLoop(
			filteredPools,
			paths,
			trySomeArb,
			getPoolStates,
			getFlashArbMessages,
			botClients,
			account,
			botConfig,
			timeouturls,
			errorpaths,
		);
	} else {
		await sendSlackMessage("loop without mempool or skip not implemented yet", slackClient, botConfig.slackChannel);
		return;
	}
	// main loop of the bot
	await loop.fetchRequiredChainData();

	console.log("starting loop");
	while (true) {
		await loop.step();
		loop.reset();
		if (loop.iterations % 150 === 0) {
			await sendSlackMessage(
				">*chain: * " +
					loop.chainid +
					" *wallet: * " +
					account.address +
					" sign of life, bot is running for " +
					loop.iterations +
					" blocks",
				slackClient,
				botConfig.slackChannel,
			);
		}
	}
}

main()//.catch((e) => {
	//console.error(e);
	//process.exit(1);
//});
