import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import dotenv from "dotenv";

import * as chains from "./chains";
import { trySomeArb } from "./core/arbitrage/arbitrage";
import { Logger } from "./core/logging";
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
console.log("USE SKIP: ", botConfig.useSkip);
if (botConfig.useSkip) {
	console.log("SKIP URL: ", botConfig.skipRpcUrl);
}
console.log("---".repeat(30));

/**
 * Runs the main program.
 */
async function main() {
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
	const [account, botClients] = await getChainOperator(botConfig);
	const logger = new Logger(botConfig);
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
	if (
		botConfig.useSkip &&
		botConfig.skipRpcUrl !== undefined &&
		botConfig.skipBidRate !== undefined &&
		botConfig.skipBidWallet !== undefined
	) {
		console.log("Initializing skip loop");
		const [skipClient, skipSigner] = await getSkipClient(
			botConfig.skipRpcUrl,
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
			logger,
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
			logger,
		);
	} else {
		await logger.sendMessage("**Info:** loop without mempool or skip not implemented yet");
		return;
	}
	// main loop of the bot
	await loop.fetchRequiredChainData();

	console.log("starting loop");
	while (true) {
		await loop.step();
		loop.reset();
		if (loop.iterations % 150 === 0) {
			const message = `**chain:** ${loop.chainid} **wallet:** ${account.address} **status:** running for ${loop.iterations} blocks`;
			await logger.sendMessage(message);
		}
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
