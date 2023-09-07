import dotenv from "dotenv";
import fs from "fs";

import { ChainOperator } from "./core/chainOperator/chainoperator";
import { Logger } from "./core/logging";
import { DexLoop } from "./core/types/arbitrageloops/loops/dexloop";
import { IBCLoop } from "./core/types/arbitrageloops/loops/ibcloop";
import { LiquidationLoop } from "./core/types/arbitrageloops/loops/liqMempoolLoop";
import { BotConfig, ChainConfig, setBotConfig, setChainConfig, SetupType } from "./core/types/base/configs";

/**
 * Runs the main program.
 */
async function main() {
	//read bot configuration files//
	const botConfigOutput = dotenv.config({ path: "./src/envs/bot/botsetup.env" });
	if (!botConfigOutput.parsed) {
		console.error("Cannot read botconfig env file", 1);
		process.exit(1);
	}
	const botConfig: BotConfig = await setBotConfig(botConfigOutput.parsed);
	await delay(1000);
	/*******************************/

	//read chain configuration files//
	const chainConfigs: Array<ChainConfig> = [];
	fs.readdirSync("./src/envs", { encoding: null, withFileTypes: true }).forEach(async (file) => {
		const dotenvResponse = dotenv.config({ path: "./src/envs/" + file.name });
		if (dotenvResponse.parsed) {
			chainConfigs.push(await setChainConfig(dotenvResponse.parsed, botConfig));
		}
	});
	await delay(1000);
	/********************************/

	//setup logging//
	const logger = new Logger(botConfig);
	await logger.loopLogging.logConfig(botConfig);
	/*******************************/

	//spawn chainOperator for chain interaction for each chainconfig//
	let chainOperator: any;
	if (chainConfigs.length > 1) {
		chainConfigs.forEach(async (config: any) => {
			chainOperator.push(await ChainOperator.connectWithSigner(config));
		});
	} else {
		chainOperator = await ChainOperator.connectWithSigner(chainConfigs[0]);
	}
	/*******************************/

	//create the arbitrage loop based on input config
	let loop;
	switch (configs[0].setupType) {
		case SetupType.DEX:
			loop = await DexLoop.createLoop(chainOperator, <DexConfig>chainConfigs[0], logger);
			//print the created arbitrage loop
			await logger.loopLogging.logDexLoop(loop);
			break;
		case SetupType.LIQUIDATION:
			loop = await LiquidationLoop.createLoop(chainOperator, <LiquidationConfig>chainConfigs[0], logger);
			//print the created arbitrage loop
			await logger.loopLogging.logLiqLoop(loop);
			break;
		case SetupType.IBC:
			loop = await IBCLoop.createLoop(chainOperator, chainConfigs, logger);
			await logger.loopLogging.logIBCLoop(loop);
			break;
	}

	let startupTime = Date.now();
	let timeIt = 0;
	while (true && loop) {
		await loop.step();
		await loop.reset();
		const now = Date.now();
		if (startupTime - now + botConfig.signOfLife * 60000 <= 0) {
			timeIt++;
			const mins = (botConfig.signOfLife * timeIt) % 60;
			const hours = ~~((botConfig.signOfLife * timeIt) / 60);
			startupTime = now;
			const message = `**chain:** ${chainOperator.client.chainId} **wallet:**  **status:** running for ${
				loop.iterations
			} blocks or ${hours === 0 ? "" : hours + " Hour(s) and "}${mins} Minutes`;
			loop.clearIgnoreAddresses();

			//switching RPCS every 6 Hrs
			if (mins == 0 && hours === 6 && botConfig.rpcUrls.length > 1) {
				await chainOperator.client.getNewClients();
			}
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
