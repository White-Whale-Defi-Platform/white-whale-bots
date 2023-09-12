import dotenv from "dotenv";
import fs from "fs";

import { Logger } from "./core/logging";
import { DexLoopInterface } from "./core/types/arbitrageloops/interfaces/dexloopInterface";
import { DexLoop } from "./core/types/arbitrageloops/loops/dexloop";
import { IBCLoop } from "./core/types/arbitrageloops/loops/ibcloop";
import { LiquidationLoop } from "./core/types/arbitrageloops/loops/liqMempoolLoop";
import {
	BotConfig,
	ChainConfig,
	LiquidationChainConfig,
	setBotConfig,
	setChainConfig,
	SetupType,
} from "./core/types/base/configs";

/**
 * Runs the main program.
 */
async function main() {
	//read bot configuration files//
	const botConfigOutput = dotenv.config({ path: "./src/envs/bot/botconfig.env" });
	if (!botConfigOutput.parsed) {
		console.error("Cannot read botconfig env file", 1);
		process.exit(1);
	}
	const botConfig: BotConfig = await setBotConfig(botConfigOutput.parsed);
	await delay(1000);
	/*******************************/

	//read chain configuration files//
	const chainConfigs: Array<ChainConfig> = [];
	fs.readdirSync("./src/envs/chains/", { encoding: null, withFileTypes: true }).forEach(async (file) => {
		const dotenvResponse = dotenv.config({ path: "./src/envs//chains/" + file.name });
		if (dotenvResponse.parsed) {
			chainConfigs.push(await setChainConfig(dotenvResponse.parsed, botConfig));
		}
	});
	await delay(1000);
	/********************************/

	//setup logging//
	const logger = new Logger(botConfig);
	await logger.loopLogging.logConfig(botConfig, chainConfigs[0]);
	/*******************************/

	//create the arbitrage loop based on input config
	let loop;
	switch (botConfig.setupType) {
		case SetupType.DEX:
			loop = await DexLoop.createLoop(botConfig, chainConfigs[0], logger);
			//print the created arbitrage loop
			await logger.loopLogging.logDexLoop(loop);
			break;
		case SetupType.LIQUIDATION:
			loop = await LiquidationLoop.createLoop(botConfig, <LiquidationChainConfig>chainConfigs[0], logger);
			//print the created arbitrage loop
			await logger.loopLogging.logLiqLoop(loop);
			break;
		case SetupType.IBC:
			loop = await IBCLoop.createLoop(botConfig, chainConfigs, logger);
			// await logger.loopLogging.logIBCLoop(loop);
			break;
	}

	let startupTime = Date.now();
	let timeIt = 0;
	while (true && loop) {
		await loop.step();
		await loop.reset();
		const now = Date.now();
		if (botConfig.setupType === SetupType.DEX || botConfig.setupType === SetupType.LIQUIDATION)
			if (startupTime - now + botConfig.signOfLife * 60000 <= 0) {
				timeIt++;
				const mins = (botConfig.signOfLife * timeIt) % 60;
				const hours = ~~((botConfig.signOfLife * timeIt) / 60);
				startupTime = now;
				const message = `**chain:** ${
					(<DexLoopInterface>loop).chainOperator.client.chainId
				} **wallet:**  **status:** running for ${loop.iterations} blocks or ${
					hours === 0 ? "" : hours + " Hour(s) and "
				}${mins} Minutes`;
				loop.clearIgnoreAddresses();

				// //switching RPCS every 6 Hrs
				// if (mins == 0 && hours === 6 && botConfig.rpcUrls.length > 1) {
				// 	await chainOperator.client.getNewClients();
				// }
				await logger.sendMessage(message);
			}
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
