import dotenv from "dotenv";

import * as chains from "./chains";
import { trySomeArb } from "./core/arbitrage/arbitrage";
import { getPaths, newGraph } from "./core/arbitrage/graph";
import { ChainOperator } from "./core/chainOperator/chainoperator";
<<<<<<< HEAD
import { getSkipClient } from "./core/chainOperator/skipclients";
import { Logger } from "./core/logging";
import { MempoolLoop } from "./core/types/arbitrageloops/mempoolLoop";
<<<<<<< HEAD
=======
import { Logger } from "./core/logging";
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
=======
>>>>>>> 43d9cec (feat: nomempool loop and injective client support)
import { NoMempoolLoop } from "./core/types/arbitrageloops/nomempoolLoop";
import { SkipLoop } from "./core/types/arbitrageloops/skipLoop";
import { setBotConfig } from "./core/types/base/botConfig";
import { LogType } from "./core/types/base/logging";
import { removedUnusedPools } from "./core/types/base/pool";
// load env files
<<<<<<< HEAD
<<<<<<< HEAD
dotenv.config({ path: "juno.env" });
=======
dotenv.config({ path: "injective.env" });
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
=======
dotenv.config({ path: "juno.env" });
>>>>>>> 43d9cec (feat: nomempool loop and injective client support)
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

// let getPoolStates: (chainOperator: ChainOperator, pools: Array<Pool>) => void;
/**
 *
 */
async function main() {
	const logger = new Logger(botConfig);
<<<<<<< HEAD
<<<<<<< HEAD
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
=======
	const getFlashArbMessages = chains.defaults.getFlashArbMessages;
	const getPoolStates = chains.defaults.getPoolStates;
	const initPools = chains.defaults.initPools;
	let startupTime = Date.now();
	let timeIt = 0;

	// await import("./chains/" + botConfig.chainPrefix).then(async (chainSetups) => {
	// 	if (chainSetups === undefined) {
	// 		await logger.sendMessage("Unable to resolve specific chain imports, using defaults", LogType.Console);
	// 	}
	// 	getFlashArbMessages = chainSetups.getFlashArbMessages;
	// 	getPoolStates = chainSetups.getPoolStates;
	// 	initPools = chainSetups.initPools;
	// 	return;
	// });
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
=======
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
>>>>>>> 43d9cec (feat: nomempool loop and injective client support)

	const chainOperator = await ChainOperator.connectWithSigner(botConfig);
	let setupMessage = "---".repeat(30);

	const allPools = await initPools(chainOperator, botConfig.poolEnvs, botConfig.mappingFactoryRouter);
<<<<<<< HEAD
<<<<<<< HEAD
	const graph = newGraph(allPools);
	const paths = getPaths(graph, botConfig.offerAssetInfo, botConfig.maxPathPools) ?? [];
=======
	console.log(inspect(allPools, { showHidden: true, depth: null, colors: true }));
	const graph = newGraph(allPools);
	const paths = getPaths(graph, botConfig.offerAssetInfo, botConfig.maxPathPools) ?? [];

	await getPoolStates(chainOperator, allPools);
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
=======
	const graph = newGraph(allPools);
	const paths = getPaths(graph, botConfig.offerAssetInfo, botConfig.maxPathPools) ?? [];
>>>>>>> 43d9cec (feat: nomempool loop and injective client support)
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
<<<<<<< HEAD
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
			chainOperator,
			botConfig,
			skipClient,
			skipSigner,
			logger,
			[...paths],
		);
	} else if (botConfig.useMempool === true) {
=======
	// if (botConfig.skipConfig) {
	// 	await logger.sendMessage("Initializing skip loop...", LogType.Console);
	// 	// const [skipClient, skipSigner] = await getSkipClient(
	// 	// 	botConfig.skipConfig.skipRpcUrl,
	// 	// 	botConfig.mnemonic,
	// 	// 	botConfig.chainPrefix,
	// 	// );
	// 	// loop = new SkipLoop(
	// 	// 	filteredPools,
	// 	// 	paths,
	// 	// 	trySomeArb,
	// 	// 	getPoolStates,
	// 	// 	getFlashArbMessages,
	// 	// 	chainOperator,
	// 	// 	botConfig,
	// 	// 	skipClient,
	// 	// 	skipSigner,
	// 	// 	logger,
	// 	// 	[...paths],
	// 	// );
	// } else
	if (botConfig.useMempool === true) {
>>>>>>> 43d9cec (feat: nomempool loop and injective client support)
		await logger.sendMessage("Initializing mempool loop...", LogType.Console);

		loop = new MempoolLoop(
			filteredPools,
			paths,
			trySomeArb,
			getPoolStates,
			getFlashArbMessages,
			chainOperator,
			botConfig,
			logger,
			[...paths],
		);
	} else {
		await logger.sendMessage("Initializing non-mempool loop...", LogType.Console);
		loop = new NoMempoolLoop(
			filteredPools,
			paths,
			trySomeArb,
			getPoolStates,
			getFlashArbMessages,
			chainOperator,
			botConfig,
			logger,
			[...paths],
		);
	}

	// main loop of the bot
	// await loop.fetchRequiredChainData();

	await logger.sendMessage("Starting loop...", LogType.All);
	while (true) {
		await loop.step();
		loop.reset();
		if (startupTime - Date.now() + botConfig.signOfLife * 60000 <= 0) {
			timeIt++;
			const mins = (botConfig.signOfLife * timeIt) % 60;
			const hours = ~~((botConfig.signOfLife * timeIt) / 60);
			startupTime = Date.now();
			const message = `**chain:** ${loop.chainid} **wallet:**  **status:** running for ${
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
