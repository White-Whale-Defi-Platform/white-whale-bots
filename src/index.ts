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
import { LogType } from "./core/types/base/logging";
import { getPathsFromPool, getPathsFromPools3Hop } from "./core/types/base/path";
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
**USE SKIP:** \t${botConfig.useSkip}
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
	const paths = getPathsFromPool(allPools, botConfig.offerAssetInfo);
	const paths2 = getPathsFromPools3Hop(allPools, botConfig.offerAssetInfo);
	const filteredPools = removedUnusedPools(allPools, paths);

	setupMessage += `
Derived Paths for Arbitrage:\n
**2 HOP Paths:** \t${paths.length}
**3 HOP Paths:** \t${paths2.length}\n`;

	paths.push(...paths2);

	setupMessage += `**Total Paths:** \t${paths.length}\n`;
	setupMessage += `(Removed ${allPools.length - filteredPools.length} unused pools)\n`;
	setupMessage += "---".repeat(30);

	startupMessage += setupMessage;

	await logger.sendMessage(startupMessage, LogType.Console);

	let loop;
	if (botConfig.skipconfig)
	{
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
