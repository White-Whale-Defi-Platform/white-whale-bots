import dotenv from "dotenv";
import fs from "fs";

import { ChainOperator } from "./core/chainOperator/chainoperator";
import { Logger } from "./core/logging";
import { DexLoop } from "./core/types/arbitrageloops/loops/dexloop";
import { LiquidationLoop } from "./core/types/arbitrageloops/loops/liqMempoolLoop";
import { DexConfig, LiquidationConfig, setBotConfig, SetupType } from "./core/types/base/configs";
import { IBCLoop } from "./core/types/arbitrageloops/loops/ibcloop";
// load env files
dotenv.config({ path: "./src/envs/.env" });

/**
 * Runs the main program.
 */
async function main() {
	const configs = [];
	let botConfig: any;
	//creat config based on environment variables
	if (process.env.SETUP_TYPE == "dex" || process.env.SETUP_TYPE == "liquidation") {
		const chain = process.env.FILE;
		configs.push(dotenv.parse(fs.readFileSync("./src/envs/" + process.env.FILE + ".env")));
		configs[0].SETUP_TYPE = process.env.SETUP_TYPE;
		botConfig = await setBotConfig(configs[0]);
	} else {
		const tmp = fs.readdirSync("./src/envs/");

		for (let i = 0; i< tmp.length; i++){
			const elem = tmp[i]
			if (elem != ".env" && elem.endsWith(".env")) {
				const tmpcfg = dotenv.parse(fs.readFileSync("./src/envs/" + elem, { encoding: "utf-8" }));
				tmpcfg.SETUP_TYPE = process.env.SETUP_TYPE;
				botConfig = await setBotConfig(tmpcfg);
				configs.push(botConfig);
			}
		};
		
	}
	console.log(configs[0])

	//create a logger based on the config
	const logger = new Logger(configs[0]);

	// print the config
	await logger.loopLogging.logConfig(configs[0]);
	//spawn chainOperator for interaction with blockchains
	let chainOperator:any
	if (configs.length > 1){
		configs.forEach(async (config:any)=> {
			chainOperator.push(await ChainOperator.connectWithSigner(config))
		})
	} else {
		chainOperator = await ChainOperator.connectWithSigner(configs[0]);
	}
	//create the arbitrage loop based on input config
	let loop;
	switch (configs[0].setupType) {
		case SetupType.DEX:
			loop = await DexLoop.createLoop(chainOperator, <DexConfig>configs[0], logger);
			//print the created arbitrage loop
			await logger.loopLogging.logDexLoop(loop);
			break;
		case SetupType.LIQUIDATION:
			loop = await LiquidationLoop.createLoop(chainOperator, <LiquidationConfig>configs[0], logger);
			//print the created arbitrage loop
			await logger.loopLogging.logLiqLoop(loop);
			break;
		case SetupType.IBC:
			loop = await IBCLoop.createLoop(chainOperator, configs, logger)
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
