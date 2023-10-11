import { messageFactory } from "../../../../chains/defaults";
import { OptimalTrade, tryAmmArb, tryOrderbookArb } from "../../../arbitrage/arbitrage";
import { getPaths, newGraph } from "../../../arbitrage/graph";
import { OptimalOrderbookTrade } from "../../../arbitrage/optimizers/orderbookOptimizer";
import { getChainTransfer } from "../../../ibc/chainTransfer";
import { Logger } from "../../../logging";
import { Chain, initChain } from "../../base/chain";
import { BotConfig, ChainConfig } from "../../base/configs";
import { OrderbookPath, Path } from "../../base/path";
import { removedUnusedPools } from "../../base/pool";
import { DexLoopInterface } from "../interfaces/dexloopInterface";

/**
 *
 */
export class IBCLoop {
	paths: Array<Path>; //holds all known paths minus cooldowned paths
	orderbookPaths: Array<OrderbookPath>;
	pathlib: Array<Path>; //holds all known paths
	CDpaths: Map<string, [number, number, number]>; //holds all cooldowned paths' identifiers
	chains: Array<Chain>;
	botConfig: any;
	logger: Logger | undefined;
	iterations = 0;
	messageFactory: DexLoopInterface["messageFactory"];
	ammArb: (paths: Array<Path>, chainConfig: ChainConfig) => OptimalTrade | undefined;
	orderbookArb: (paths: Array<OrderbookPath>, chainConfig: ChainConfig) => OptimalOrderbookTrade | undefined;

	/**
	 *
	 */
	public constructor(
		botConfig: BotConfig,
		chains: Array<Chain>,
		logger: Logger | undefined,
		messageFactory: DexLoopInterface["messageFactory"],
	) {
		const allPools = chains.flatMap((chain) => chain.pools);

		const graph = newGraph(allPools, true);
		//test values
		const paths: Array<Path> = [];
		const uniqueStartingAssets = [...new Set(chains.flatMap((chain) => Array.from(chain.chainAssets.keys())))];

		//derive all paths for all starting assets on all chains
		uniqueStartingAssets.map((startingAssetName) => {
			console.log("starting asset: ", startingAssetName);
			const saPaths = getPaths(graph, startingAssetName, botConfig.maxPathPools, true);
			console.log("paths: ", saPaths?.length);
			if (saPaths) {
				paths.push(...saPaths);
				console.log("===".repeat(20));
			}
		});

		//remove all pools from all chains that arent in any path
		console.log("total paths: ", paths.length);
		chains.map((chain) => {
			console.log(chain.chainConfig.chainPrefix);
			console.log("total pools in chain: ", chain.pools.length);
			chain.pools = removedUnusedPools(chain.pools, paths);
			console.log("total pools in chain: ", chain.pools.length);
		});

		this.chains = chains;
		//store IBC transfer messages from all chains to each other
		this.chains.map((sourceChain) => {
			this.chains.map(async (destChain) => {
				if (sourceChain.chainOperator.client.chainId === destChain.chainOperator.client.chainId) {
					return;
				} else {
					await getChainTransfer(sourceChain, destChain);
				}
			});
		});
		this.paths = paths;
		this.pathlib = paths;
		this.orderbookPaths = [];
		// this.orderbookPaths = orderbookPaths;
		this.CDpaths = new Map<string, [number, number, number]>();
		// this.paths = paths;
		// this.pathlib = paths;
		this.ammArb = tryAmmArb;
		this.orderbookArb = tryOrderbookArb;
		this.messageFactory = messageFactory;
		this.botConfig = botConfig;
		this.logger = logger;
	}
	/**
	 *
	 */
	static async createLoop(botConfig: BotConfig, chainConfigs: Array<ChainConfig>, logger: Logger): Promise<IBCLoop> {
		const chains: Array<Chain> = [];
		for (const chainConfig of chainConfigs) {
			const chain: Chain = await initChain(chainConfig, logger);
			chains.push(chain);
		}
		return new IBCLoop(botConfig, chains, logger, messageFactory);
	}
	/*
		const orderbooks: Array<Orderbook> = [];
		if (botConfig.chainPrefix === "inj" && botConfig.orderbooks && botConfig.orderbooks.length > 0) {
			const obs = await initOrderbook(operator, botConfig);
			if (obs) {
				orderbooks.push(...obs);
			}
		}
		const originPools = await initPools(operator, botConfig.poolEnvs, botConfig.mappingFactoryRouter);
		let poolsOtherChains: any;
		let diffassets: any = new Set();

		for (let y = 0; y < originPools.length; y++) {
			originPools[y].chainID = operator.client.chainId;
			diffassets.add(originPools[y].assets[0].info);
			diffassets.add(originPools[y].assets[1].info);
		}
		const options = {
			method: "POST",
			url: "https://api.skip.money/v1/fungible/assets_from_source",
			headers: { accept: "application/json", "content-type": "application/json" },
			data: {},
		};
		diffassets = [...diffassets];
		for (let x = 0; x < chainOperator.length; x++) {
			if (chainOperator[x].client.chainId !== operator.client.chainId) {
				const portedpools: any = [];
				for (let y = 0; y < diffassets.length; y++) {
					options.data = {
						allow_multi_tx: false,
						source_asset_chain_id: operator.client.chainId,
						source_asset_denom: diffassets[y],
					};
					await axios.request(options);
				}
				poolsOtherChains[chainOperator[x].client.chainId] = portedpools;
			} else {
			}
		}

		return new IBCLoop(
			chainOperator,
			botConfig,
			logger,
			allPools,
			orderbooks,
			getPoolStates,
			messageFactory,
			getOrderbookState,
		);
	}
	*/
	/**
	 *
	 */
	public async step() {
		// this.chains.map((chain) => {
		// 	chain.pools.forEach((pool) => {
		// 		console.log(pool.address, pool.ibcAssets[0], pool.ibcAssets[1]);
		// 	});
		// });
		await delay(10000);
		this.iterations++;

		/*
		const arbTrade: OptimalTrade | undefined = this.ammArb(this.paths, this.botConfig);
		const arbtradeOB = this.orderbookArb(this.orderbookPaths, this.botConfig);

		if (arbTrade && arbtradeOB) {
			if (arbTrade.profit > arbtradeOB.profit) {
				await this.trade(arbTrade);
				this.cdPaths(arbTrade.path);
			} else if (arbtradeOB.profit >= arbTrade.profit) {
				await this.trade(arbtradeOB);
				this.cdPaths(arbtradeOB.path);
			}
		} else if (arbTrade) {
			await this.trade(arbTrade);
			this.cdPaths(arbTrade.path);
		} else if (arbtradeOB) {
			await this.trade(arbtradeOB);
			this.cdPaths(arbtradeOB.path);
		}

		// await this.chainOperator.reset();
		*/
	}

	/**
	 *
	 */
	async reset() {
		this.unCDPaths();
		await Promise.all(this.chains.map((chain) => chain.updatePoolStates(chain.chainOperator, chain.pools)));
		if (this.orderbookPaths.length > 0) {
			await Promise.all(
				this.chains.map((chain) => {
					if (chain.updateOrderbookStates) {
						return chain.updateOrderbookStates(chain.chainOperator, chain.orderbooks);
					}
				}),
			);
		}
	}

	/**
	 *
	 */
	// public async trade(arbTrade: OptimalTrade | OptimalOrderbookTrade) {
	// 	const publicAddress = this.chainOperator.client.publicAddress;
	// 	const messages = this.messageFactory(arbTrade, publicAddress, this.botConfig.flashloanRouterAddress);
	// 	if (!messages) {
	// 		console.error("error in creating messages", 1);
	// 		process.exit(1);
	// 	}
	// 	if (isOrderbookPath(arbTrade.path)) {
	// 		if (arbTrade.path.orderSequence === OrderSequence.AmmFirst) {
	// 			const txResponse = await this.chainOperator.signAndBroadcast(messages[0]);
	// 			await this.logger?.tradeLogging.logOrderbookTrade(<OptimalOrderbookTrade>arbTrade, [txResponse]);
	// 		} else {
	// 			const txResponse = await this.chainOperator.signAndBroadcast([messages[0][0]]);
	// 			await delay(2000);
	// 			const txResponse2 = await this.chainOperator.signAndBroadcast([messages[0][1]]);
	// 			await this.logger?.tradeLogging.logOrderbookTrade(<OptimalOrderbookTrade>arbTrade, [
	// 				txResponse,
	// 				txResponse2,
	// 			]);
	// 		}
	// 	} else {
	// 		const txResponse = await this.chainOperator.signAndBroadcast(messages[0]);
	// 		await this.logger?.tradeLogging.logAmmTrade(<OptimalTrade>arbTrade, [txResponse]);
	// 	}
	// 	await delay(10000);
	// }
	/**
	 * Put path on Cooldown, add to CDPaths with iteration number as block.
	 * Updates the iteration count of elements in CDpaths if its in equalpath of param: path
	 * Updates this.Path.
	 */
	public cdPaths(path: Path | OrderbookPath) {
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
