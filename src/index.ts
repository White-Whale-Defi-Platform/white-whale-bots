import dotenv from "dotenv";

import * as chains from "./chains";
import { initLiquidationOverseers } from "./chains/defaults/queries/initOverseers";
import { ChainOperator } from "./core/chainOperator/chainoperator";
import { Logger } from "./core/logging";
import { LiquidationLoop } from "./core/types/arbitrageloops/liquidationLoop";
import { setBotConfig } from "./core/types/base/botConfig";
import { LogType } from "./core/types/base/logging";
// load env files
dotenv.config({ path: "./src/envs/terra.env" });

/**
 * Runs the main program.
 */

// let getPoolStates: (chainOperator: ChainOperator, pools: Array<Pool>) => void;
/**
 *
 */
async function main() {
	const botConfig = await setBotConfig(process.env);
	let startupMessage = "===".repeat(30);
	startupMessage += "\n**White Whale Bot**\n";
	startupMessage += "===".repeat(30);
	startupMessage += `\nEnvironment Variables:\n
**RPC ENDPOINT SCRAPER: ** \t${botConfig.useRpcUrlScraper}
**RPC ENPDOINTS:** \t${botConfig.rpcUrls}
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
	const logger = new Logger(botConfig);
	let getFlashArbMessages = chains.defaults.getFlashArbMessages;
	let getPoolStates = chains.defaults.getPoolStates;
	let initPools = chains.defaults.initPools;
	const startupTime = Date.now();
	const timeIt = 0;

	await import("./chains/" + botConfig.chainPrefix).then(async (chainSetups) => {
		if (chainSetups === undefined) {
			await logger.sendMessage("Unable to resolve specific chain imports, using defaults", LogType.Console);
		}
		getFlashArbMessages = chainSetups.getFlashArbMessages;
		getPoolStates = chainSetups.getPoolStates;
		initPools = chainSetups.initPools;
		return;
	});
	const chainOperator = await ChainOperator.connectWithSigner(botConfig);

	// let setupMessage = "---".repeat(30);
	// 	const allPools = await initPools(chainOperator, botConfig.poolEnvs, botConfig.mappingFactoryRouter);
	// 	const graph = newGraph(allPools);
	// 	const paths = getPaths(graph, botConfig.offerAssetInfo, botConfig.maxPathPools) ?? [];

	// 	const filteredPools = removedUnusedPools(allPools, paths);
	// 	setupMessage += `**\nDerived Paths for Arbitrage:
	// Total Paths:** \t${paths.length}\n`;
	// 	for (let pathlength = 2; pathlength <= botConfig.maxPathPools; pathlength++) {
	// 		const nrOfPaths = paths.filter((path) => path.pools.length === pathlength).length;
	// 		setupMessage += `**${pathlength} HOP Paths:** \t${nrOfPaths}\n`;
	// 	}
	// 	setupMessage += `(Removed ${allPools.length - filteredPools.length} unused pools)\n`;
	// 	setupMessage += "---".repeat(30);

	// 	startupMessage += setupMessage;

	const overseers = await initLiquidationOverseers(botConfig.overseerAddresses, chainOperator);

	await logger.sendMessage(startupMessage, LogType.Console);

	const loop = new LiquidationLoop(chainOperator, botConfig, overseers);
	console.log(
		Object.keys(loop.allOverseerAddresses),
		Object.keys(loop.allOverseerPriceFeeders),
		Object.keys(loop.allOverseerMoneyMarkets),
	);
	while (true) {
		await loop.step();
	}
	// if (botConfig.skipConfig) {
	// 	await logger.sendMessage("Initializing skip loop...", LogType.Console);
	// 	const [skipClient, skipSigner] = await getSkipClient(
	// 		botConfig.skipConfig.skipRpcUrl,
	// 		botConfig.mnemonic,
	// 		botConfig.chainPrefix,
	// 	);
	// 	loop = new SkipLoop(
	// 		filteredPools,
	// 		paths,
	// 		trySomeArb,
	// 		getPoolStates,
	// 		getFlashArbMessages,
	// 		chainOperator,
	// 		botConfig,
	// 		skipClient,
	// 		skipSigner,
	// 		logger,
	// 		[...paths],
	// 		botConfig.ignoreAddresses,
	// 		liquidate,
	// 	);
	// } else if (botConfig.useMempool === true) {
	// 	await logger.sendMessage("Initializing mempool loop...", LogType.Console);

	// 	loop = new MempoolLoop(
	// 		filteredPools,
	// 		paths,
	// 		trySomeArb,
	// 		getPoolStates,
	// 		getFlashArbMessages,
	// 		chainOperator,
	// 		botConfig,
	// 		logger,
	// 		[...paths],
	// 		botConfig.ignoreAddresses,
	// 		liquidate,
	// 	);
	// } else {
	// 	await logger.sendMessage("Initializing non-mempool loop...", LogType.Console);
	// 	loop = new NoMempoolLoop(
	// 		filteredPools,
	// 		paths,
	// 		trySomeArb,
	// 		getPoolStates,
	// 		getFlashArbMessages,
	// 		chainOperator,
	// 		botConfig,
	// 		logger,
	// 		[...paths],
	// 	);
	// }

	// main loop of the bot
	// await loop.fetchRequiredChainData();

	// await logger.sendMessage("Starting loop...", LogType.All);
	// while (true) {
	// 	await loop.step();
	// 	await loop.reset();
	// 	const now = Date.now();
	// 	if (startupTime - now + botConfig.signOfLife * 60000 <= 0) {
	// 		timeIt++;
	// 		const mins = (botConfig.signOfLife * timeIt) % 60;
	// 		const hours = ~~((botConfig.signOfLife * timeIt) / 60);
	// 		startupTime = now;
	// 		const message = `**chain:** ${chainOperator.client.chainId} **wallet:**  **status:** running for ${
	// 			loop.iterations
	// 		} blocks or ${hours === 0 ? "" : hours + " Hour(s) and "}${mins} Minutes`;
	// 		loop.clearIgnoreAddresses();
	// 		//switching RPCS every 6 Hrs
	// 		if (mins == 0 && hours === 6 && botConfig.rpcUrls.length > 1) {
	// 			await chainOperator.client.getNewClients();
	// 		}
	// 		await logger.sendMessage(message);
	// 	}
	// }
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
