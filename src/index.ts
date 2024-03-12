import dotenv from "dotenv";

import { ChainOperator } from "./core/chainOperator/chainoperator";
import { Logger } from "./core/logging";
import { DexLoop } from "./core/types/arbitrageloops/loops/dexloop";
import { DexConfig, setBotConfig } from "./core/types/base/configs";
// load env files
dotenv.config({ path: "./src/envs/chains/injective.env" });

/**
 * Runs the main program.
 */
async function main() {
	//creat config based on environment variables
	const botConfig = await setBotConfig(process.env);

	//create a logger based on the config
	const logger = new Logger(botConfig);

	const chainOperator = await ChainOperator.connectWithSigner(botConfig);

	// const comet = await Comet38Client.connect("wss://ww-juno-rpc.polkachu.com");
	// const stream = comet.subscribeTx();

	// const listenf = {
	// 	/**
	// 	 *
	// 	 */
	// 	next(e: TxEvent) {
	// 		console.log(e);
	// 	},
	// 	/**
	// 	 *
	// 	 */
	// 	error(err: any) {
	// 		console.log(err);
	// 	},
	// 	/**
	// 	 *
	// 	 */
	// 	complete() {
	// 		console.log("completed");
	// 	},
	// };
	// stream.addListener(listenf);
	/**
	 *
	 */
	const wsLoop = await DexLoop.createLoop(chainOperator, <DexConfig>botConfig, logger);
	await wsLoop.step();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
