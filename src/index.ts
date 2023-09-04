import dotenv from "dotenv";
import fs from "fs";

import { ChainOperator } from "./core/chainOperator/chainoperator";
import { Logger } from "./core/logging";
import { DexLoop } from "./core/types/arbitrageloops/loops/dexloop";
import { IBCLoop } from "./core/types/arbitrageloops/loops/ibcloop";
import { LiquidationLoop } from "./core/types/arbitrageloops/loops/liqMempoolLoop";
import { BotConfig, DexConfig, LiquidationConfig, setBotConfig, SetupType } from "./core/types/base/configs";

/**
 * Runs the main program.
 */
async function main() {
	const chainConfigs: Array<BotConfig> = [];
	fs.readdirSync("./src/envs", { encoding: null, withFileTypes: true }).forEach(async (file) => {
		const dotenvResponse = dotenv.config({ path: "./src/envs/" + file.name });
		if (dotenvResponse.parsed) {
			chainConfigs.push(await setBotConfig(dotenvResponse.parsed));
		}
	});
	await delay(1000);

	//create a logger based on the config
	const logger = new Logger(chainConfigs[0]);

	// print the config
	await logger.loopLogging.logConfig(chainConfigs[0]);
	//spawn chainOperator for interaction with blockchains
	let chainOperator: any;
	if (chainConfigs.length > 1) {
		chainConfigs.forEach(async (config: any) => {
			chainOperator.push(await ChainOperator.connectWithSigner(config));
		});
	} else {
		chainOperator = await ChainOperator.connectWithSigner(chainConfigs[0]);
	}
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
