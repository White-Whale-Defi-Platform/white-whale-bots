import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import dotenv from "dotenv";

import * as chains from "./chains";
import { trySomeArb } from "./core/arbitrage/arbitrage";
import { getPaths, newGraph } from "./core/arbitrage/graph";
import { Logger } from "./core/logging";
import { getChainOperator } from "./core/node/chainoperator";
import { getSkipClient } from "./core/node/skipclients";
import { MempoolLoop } from "./core/types/arbitrageloops/mempoolLoop";
import { SkipLoop } from "./core/types/arbitrageloops/skipLoop";
import { setBotConfig } from "./core/types/base/botConfig";
import { LogType } from "./core/types/base/logging";
import { removedUnusedPools } from "./core/types/base/pool";
// load env files
dotenv.config();
const botConfig = setBotConfig(process.env);

let startupMessage = "===".repeat(30);
startupMessage += "\n**White Whale Bot**\n";
startupMessage += "===".repeat(30);
startupMessage += `\nEnvironment Variables:\n
**RPC ENPDOINT:** \t${botConfig.rpcUrl}
**OFFER DENOM:** \t${JSON.stringify(botConfig.offerAssetInfo)}
**FACTORIES_TO_ROUTERS_MAPPING:** \t${JSON.stringify(botConfig.mappingFactoryRouter)}
**USE MEMPOOL:** \t${botConfig.useMempool}
**USE SKIP:** \t${botConfig.skipConfig?.useSkip}
`;
if (botConfig.skipConfig) {
	startupMessage += `**SKIP URL:** \t${botConfig.skipConfig.skipRpcUrl}\n`;
	startupMessage += `**SKIP BID RATE:** \t${botConfig.skipConfig.skipBidRate}\n`;
}
startupMessage += "---".repeat(30);

/**
 * Runs the main program.
 */
async function main() {
	const logger = new Logger(botConfig);
	let getFlashArbMessages = chains.defaults.getFlashArbMessages;
	let getPoolStates = chains.defaults.getPoolStates;
	let initPools = chains.defaults.initPools;
	let startupTime = Date.now();
	let timeIt = 0;

	await import("./chains/" + botConfig.chainPrefix).then(async (chainSetups) => {
		if (chainSetups === undefined) {
			await logger.sendMessage("Unable to resolve specific chain imports, using defaults", LogType.Console);
		}
		getFlashArbMessages = chainSetups.getFlashArbMessages;
		getPoolStates = chainSetups.getPoolStates;
		initPools = chainSetups.initPools;
		return;
	});

	const [account, botClients] = await getChainOperator(botConfig);
	const { accountNumber, sequence } = await botClients.SigningCWClient.getSequence(account.address);
	const chainId = await (
		await botClients.HttpClient.execute(createJsonRpcRequest("block"))
	).result.block.header.chain_id;
	let setupMessage = `
Connections Details:\n
**Account Number:** ${accountNumber}
**Sequence:** \t${sequence}
**Chain Id:** \t${chainId}\n`;
	setupMessage += "---".repeat(30);

	const allPools = await initPools(botClients, botConfig.poolEnvs, botConfig.mappingFactoryRouter);
	const graph = newGraph(allPools);
	const paths = getPaths(graph, botConfig.offerAssetInfo, botConfig.maxPathPools) ?? [];

	const filteredPools = removedUnusedPools(allPools, paths);
	setupMessage += `**\nDerived Paths for Arbitrage:
Total Paths:** \t${paths.length}\n`;
	for (let pathlength = 2; pathlength <= botConfig.maxPathPools; pathlength++) {
		const nrOfPaths = paths.filter((path) => path.pools.length === pathlength).length;
		setupMessage += `**${pathlength} HOP Paths:** \t${nrOfPaths}\n`;
	}

	setupMessage += `(Removed ${allPools.length - filteredPools.length} unused pools)\n`;
	setupMessage += "---".repeat(30);

	startupMessage += setupMessage;
	await logger.sendMessage(startupMessage, LogType.Console);

	let loop;
	if (botConfig.skipConfig) {
		await logger.sendMessage("Initializing skip loop...", LogType.Console);
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
			logger,
		);
	} else if (botConfig.useMempool === true) {
		await logger.sendMessage("Initializing mempool loop...", LogType.Console);

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

	await logger.sendMessage("Starting loop...", LogType.All);
	while (true) {
		await loop.step();
		loop.reset();
		if (startupTime - Date.now() + botConfig.signOfLife * 60000 <= 0) {
			timeIt++;
			const mins = (botConfig.signOfLife * timeIt) % 60;
			const hours = ~~((botConfig.signOfLife * timeIt) / 60);
			startupTime = Date.now();
			const message = `**chain:** ${loop.chainid} **wallet:** ${account.address} **status:** running for ${
				loop.iterations
			} blocks or ${hours === 0 ? "" : hours + " Hour(s) and "}${mins} Minutes`;
			await logger.sendMessage(message);
		}
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
