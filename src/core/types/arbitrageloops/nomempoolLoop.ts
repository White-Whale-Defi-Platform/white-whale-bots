import { EncodeObject } from "@cosmjs/proto-signing";
import { inspect } from "util";

import { OptimalTrade } from "../../arbitrage/arbitrage";
import { ChainOperator } from "../../chainOperator/chainoperator";
import { Logger } from "../../logging";
import { BotConfig } from "../base/botConfig";
import { flushTxMemory, Mempool } from "../base/mempool";
import { Path } from "../base/path";
import { Pool } from "../base/pool";

/**
 *
 */
export class NoMempoolLoop {
	pools: Array<Pool>;
	paths: Array<Path>; //holds all known paths minus cooldowned paths
	pathlib: Array<Path>; //holds all known paths
	CDpaths: Map<string, [number, number, number]>; //holds all cooldowned paths' identifiers
	chainOperator: ChainOperator;
	accountNumber = 0;
	sequence = 0;
	chainid = "";
	botConfig: BotConfig;
	logger: Logger | undefined;
	// CACHE VALUES
	totalBytes = 0;
	mempool!: Mempool;
	iterations = 0;

	/**
	 *
	 */
	arbitrageFunction: (paths: Array<Path>, botConfig: BotConfig) => OptimalTrade | undefined;
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
		pools: Array<Pool>,
		paths: Array<Path>,
		arbitrage: (paths: Array<Path>, botConfig: BotConfig) => OptimalTrade | undefined,
		updateState: (chainOperator: ChainOperator, pools: Array<Pool>) => Promise<void>,
		messageFunction: (
			arbTrade: OptimalTrade,
			walletAddress: string,
			flashloancontract: string,
		) => [Array<EncodeObject>, number],
		chainOperator: ChainOperator,
		botConfig: BotConfig,
		logger: Logger | undefined,
		pathlib: Array<Path>,
	) {
		this.pools = pools;
		this.CDpaths = new Map<string, [number, number, number]>();

		this.paths = paths;
		this.arbitrageFunction = arbitrage;
		this.updateStateFunction = updateState;
		this.messageFunction = messageFunction;
		this.chainOperator = chainOperator;
		this.botConfig = botConfig;
		this.logger = logger;
		this.pathlib = pathlib;
	}

	/**
	 *
	 */
	public async fetchRequiredChainData() {
		// const { accountNumber, sequence } = await this.botClients.SigningCWClient.getSequence(this.account.address);
		// this.sequence = sequence;
		// this.accountNumber = accountNumber;
		// const chainId = await this.botClients.SigningCWClient.getChainId();
		// this.chainid = chainId;
	}

	/**
	 *
	 */
	public async step() {
		this.iterations++;
		await this.updateStateFunction(this.chainOperator, this.pools);

		const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig);

		if (arbTrade) {
			console.log(inspect(arbTrade.path.pools, { showHidden: true, depth: 4, colors: true }));
			console.log(inspect(arbTrade.offerAsset, { showHidden: true, depth: 3, colors: true }));
			console.log("expected profit: ", arbTrade.profit);
			await this.trade(arbTrade);
			this.cdPaths(arbTrade.path);
			return;
		}
	}

	/**
	 *
	 */
	public reset() {
		this.unCDPaths();
		this.totalBytes = 0;
		flushTxMemory();
	}

	/**
	 *
	 */
	private async trade(arbTrade: OptimalTrade) {
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
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
