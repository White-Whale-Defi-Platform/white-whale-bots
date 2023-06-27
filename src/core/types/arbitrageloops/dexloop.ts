import { EncodeObject } from "@cosmjs/proto-signing";
import { inspect } from "util";

import * as chains from "../../../chains";
import { OptimalTrade, trySomeArb } from "../../arbitrage/arbitrage";
import { getPaths, newGraph } from "../../arbitrage/graph";
import { ChainOperator } from "../../chainOperator/chainoperator";
import { Logger } from "../../logging";
import { DexConfig } from "../base/configs";
import { LogType } from "../base/logging";
import { Path } from "../base/path";
import { Pool, removedUnusedPools } from "../base/pool";

/**
 *
 */
export class DexLoop {
	pools: Array<Pool>;
	paths: Array<Path>; //holds all known paths minus cooldowned paths
	pathlib: Array<Path>; //holds all known paths
	CDpaths: Map<string, [number, number, number]>; //holds all cooldowned paths' identifiers
	chainOperator: ChainOperator;
	accountNumber = 0;
	sequence = 0;
	chainid = "";
	botConfig: DexConfig;
	logger: Logger | undefined;
	iterations = 0;

	/**
	 *
	 */
	arbitrageFunction: (paths: Array<Path>, botConfig: DexConfig) => OptimalTrade | undefined;
	updateStateFunction: (chainOperator: ChainOperator, pools: Array<Pool>) => Promise<void>;
	messageFunction: (
		arbTrade: OptimalTrade,
		walletAddress: string,
		flashloancontract: string,
	) => [Array<EncodeObject>, number];

	/**
	 *
	 */
	public constructor(
		chainOperator: ChainOperator,
		botConfig: DexConfig,
		logger: Logger | undefined,
		allPools: Array<Pool>,
		updateState: (chainOperator: ChainOperator, pools: Array<Pool>) => Promise<void>,
		messageFunction: (
			arbTrade: OptimalTrade,
			walletAddress: string,
			flashloancontract: string,
		) => [Array<EncodeObject>, number],
	) {
		const graph = newGraph(allPools);
		const paths = getPaths(graph, botConfig.offerAssetInfo, botConfig.maxPathPools) ?? [];
		const filteredPools = removedUnusedPools(allPools, paths);
		this.pools = filteredPools;
		this.CDpaths = new Map<string, [number, number, number]>();
		this.paths = paths;
		this.pathlib = paths;
		this.arbitrageFunction = trySomeArb;
		this.updateStateFunction = updateState;
		this.messageFunction = messageFunction;
		this.chainOperator = chainOperator;
		this.botConfig = botConfig;
		this.logger = logger;
	}
	/**
	 *
	 */
	public async step() {
		this.iterations++;

		const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig);

		if (arbTrade) {
			console.log(inspect(arbTrade.path.pools, { showHidden: true, depth: 4, colors: true }));
			console.log(inspect(arbTrade.offerAsset, { showHidden: true, depth: 3, colors: true }));
			console.log("expected profit: ", arbTrade.profit);
			await this.trade(arbTrade);
			this.cdPaths(arbTrade.path);
			await this.chainOperator.reset();
		}

		await delay(1500);
	}

	/**
	 *
	 */
	async reset() {
		this.unCDPaths();
		await this.updateStateFunction(this.chainOperator, this.pools);
	}

	/**
	 *
	 */
	public async trade(arbTrade: OptimalTrade) {
		const publicAddress = this.chainOperator.client.publicAddress;
		const [msgs, nrOfMessages] = this.messageFunction(
			arbTrade,
			publicAddress,
			this.botConfig.flashloanRouterAddress,
		);

		const txResponse = await this.chainOperator.signAndBroadcast(msgs);
		console.log(txResponse);
		await delay(10000);
	}
	/**
	 * Put path on Cooldown, add to CDPaths with iteration number as block.
	 * Updates the iteration count of elements in CDpaths if its in equalpath of param: path
	 * Updates this.Path.
	 */
	public cdPaths(path: Path) {
		//add equalpaths to the CDPath array
		for (const equalpath of path.equalpaths) {
			this.CDpaths.set(equalpath[0], [this.iterations, 5, equalpath[1]]);
		}
		//add self to the CDPath array
		this.CDpaths.set(path.identifier[0], [this.iterations, 10, path.identifier[1]]);

		const out = new Array<Path>();
		//remove all equal paths from this.paths if this.paths'identifier overlaps with one in equalpaths
		this.paths.forEach((activePath) => {
			//if our updated cdpaths contains the path still active, make sure to remove it from the active paths
			if (!this.CDpaths.get(activePath.identifier[0])) {
				out.push(activePath);
			}
		});
		this.paths = out;
	}

	/** Removes the CD Paths if CD iteration number of path + Cooldownblocks <= this.iterations
	 * ADDS the path from pathlibary to this.paths.
	 */
	public unCDPaths() {
		this.CDpaths.forEach((value, key) => {
			// if time set to cooldown (in iteration numbers) + cooldown amount < current iteration, remove it from cd
			if (value[0] + value[1] < this.iterations) {
				this.CDpaths.delete(key);
				//add the path back to active paths
				this.paths.push(this.pathlib[value[2]]);
			}
		});
	}

	/**
	 *
	 */
	public clearIgnoreAddresses() {
		return;
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
import { DexMempoolLoop } from "./dexMempoolloop";
import { DexMempoolSkipLoop } from "./dexMempoolSkiploop";
/**
 *
 */
export async function createLoop(chainOperator: ChainOperator, botConfig: DexConfig, logger: Logger): Promise<DexLoop> {
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
	const allPools = await initPools(chainOperator, botConfig.poolEnvs, botConfig.mappingFactoryRouter);
	if (botConfig.useMempool && !botConfig.skipConfig?.useSkip) {
		return new DexMempoolLoop(chainOperator, botConfig, logger, allPools, getPoolStates, getFlashArbMessages);
	} else if (botConfig.useMempool && botConfig.skipConfig?.useSkip) {
		return new DexMempoolSkipLoop(chainOperator, botConfig, logger, allPools, getPoolStates, getFlashArbMessages);
	}
	return new DexLoop(chainOperator, botConfig, logger, allPools, getPoolStates, getFlashArbMessages);
}
