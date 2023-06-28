import dotenv from "dotenv";

import { ChainOperator } from "./core/chainOperator/chainoperator";
import { Logger } from "./core/logging";
import { LiquidationLoop } from "./core/types/arbitrageloops/liquidationLoop";
import { DexLoop } from "./core/types/arbitrageloops/loops/dexloop";
import { DexConfig, LiquidationConfig, setBotConfig, SetupType } from "./core/types/base/configs";
import { LogType } from "./core/types/base/logging";
// load env files
dotenv.config({ path: "./src/envs/terra.env" });

/**
 * Runs the main program.
 */
async function main() {
	const botConfig = await setBotConfig(process.env);

	//todo: place this in the logger class
	let startupMessage = "===".repeat(30);
	startupMessage += "\n**White Whale Bot**\n";
	startupMessage += `\n**Setup type: ${botConfig.setupType}**\n`;
	startupMessage += "===".repeat(30);

	startupMessage += `\nEnvironment Variables:\n
	**RPC ENPDOINTS:** \t${botConfig.rpcUrls}
	**USE MEMPOOL:** \t${botConfig.useMempool}
	**USE SKIP:** \t${botConfig.skipConfig?.useSkip}
	`;
	if (botConfig.skipConfig) {
		startupMessage += `**SKIP URL:** \t${botConfig.skipConfig.skipRpcUrl}\n`;
		startupMessage += `**SKIP BID RATE:** \t${botConfig.skipConfig.skipBidRate}\n`;
	}
	startupMessage += "---".repeat(30);

	const logger = new Logger(botConfig);

	const chainOperator = await ChainOperator.connectWithSigner(botConfig);

	let loop;
	if (botConfig.setupType === SetupType.DEX) {
		await logger.sendMessage("Initializing DEX arbitrage loop...", LogType.Console);
		loop = await DexLoop.createLoop(chainOperator, <DexConfig>botConfig, logger);
	} else if (botConfig.setupType === SetupType.LIQUIDATION) {
		await logger.sendMessage("Initializing liquidation arbitrage loop...", LogType.Console);
		loop = await LiquidationLoop.createLoop(chainOperator, <LiquidationConfig>botConfig, logger);
	}

	await logger.sendMessage("Starting loop...", LogType.All);
	while (true && loop) {
		await loop.step();
		await loop.reset();
		// const now = Date.now();
		// if (startupTime - now + botConfig.signOfLife * 60000 <= 0) {
		// 	timeIt++;
		// 	const mins = (botConfig.signOfLife * timeIt) % 60;
		// 	const hours = ~~((botConfig.signOfLife * timeIt) / 60);
		// 	startupTime = now;
		// 	const message = `**chain:** ${chainOperator.client.chainId} **wallet:**  **status:** running for ${
		// 		loop.iterations
		// 	} blocks or ${hours === 0 ? "" : hours + " Hour(s) and "}${mins} Minutes`;
		// 	loop.clearIgnoreAddresses();
		// 	//switching RPCS every 6 Hrs
		// 	if (mins == 0 && hours === 6 && botConfig.rpcUrls.length > 1) {
		// 		await chainOperator.client.getNewClients();
		// 	}
		// 	await logger.sendMessage(message);
		// }
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
