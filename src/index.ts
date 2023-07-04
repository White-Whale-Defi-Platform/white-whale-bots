import dotenv from "dotenv";

import { ChainOperator } from "./core/chainOperator/chainoperator";
import { Logger } from "./core/logging";
import { DexLoop } from "./core/types/arbitrageloops/loops/dexloop";
import { LiquidationLoop } from "./core/types/arbitrageloops/loops/liqMempoolLoop";
import { DexConfig, LiquidationConfig, setBotConfig, SetupType } from "./core/types/base/configs";
// load env files
dotenv.config({ path: "./src/envs/terra.env" });

/**
 * Runs the main program.
 */
async function main() {
	//creat config based on environment variables
	const botConfig = await setBotConfig(process.env);

	//create a logger based on the config
	const logger = new Logger(botConfig);

	// print the config
	await logger.defaults.logConfig(botConfig);
	//spawn chainOperator for interaction with blockchains
	const chainOperator = await ChainOperator.connectWithSigner(botConfig);
	//create the arbitrage loop based on input config
	let loop;
	if (botConfig.setupType === SetupType.DEX) {
		loop = await DexLoop.createLoop(chainOperator, <DexConfig>botConfig, logger);

		//print the created arbitrage loop
		await logger.defaults.logDexLoop(loop);
	} else if (botConfig.setupType === SetupType.LIQUIDATION) {
		loop = await LiquidationLoop.createLoop(chainOperator, <LiquidationConfig>botConfig, logger);
		//print the created arbitrage loop
		await logger.defaults.logLiqLoop(loop);
	}

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
