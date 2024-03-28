import { fromBase64 } from "@cosmjs/encoding";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { TxEvent } from "@cosmjs/tendermint-rpc/build/comet38/responses";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { SubscriptionEvent } from "@cosmjs/tendermint-rpc/build/rpcclients";
import { IndexerSpotStreamTransformer } from "@injectivelabs/sdk-ts";
import { Subscription } from "rxjs";
import { WebSocket } from "ws";
import { Listener } from "xstream";

import { tryAmmArb, tryOrderbookArb } from "../../../arbitrage/arbitrage";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging/logger";
import { DexConfig } from "../../base/configs";
import { decodeMempool, flushTxMemory, IgnoredAddresses, Mempool, MempoolTx } from "../../base/mempool";
import { Order, Orderbook, removedUnusedOrderbooks } from "../../base/orderbook";
import { getAmmPaths, getOrderbookAmmPaths, isOrderbookPath, OrderbookPath, Path } from "../../base/path";
import { applyMempoolMessagesOnPools, Pool, removedUnusedPools } from "../../base/pool";
import { OptimalOrderbookTrade, OptimalTrade, Trade, TradeType } from "../../base/trades";
import { DexLoopInterface } from "../interfaces/dexloopInterface";
/**
 *
 */
export class DexWebsockedLoop implements DexLoopInterface {
	pools: Array<Pool>;
	orderbooks: Array<Orderbook>;
	paths: Array<Path>; //holds all known paths minus cooldowned paths
	orderbookPaths: Array<OrderbookPath>;
	CDpaths: Map<string, { timeoutIteration: number; timeoutDuration: number; path: OrderbookPath | Path }>; //holds all cooldowned paths' identifiers
	chainOperator: ChainOperator;
	accountNumber = 0;
	sequence = 0;
	botConfig: DexConfig;
	logger: Logger | undefined;
	iterations = 0;
	updatePoolStates: DexLoopInterface["updatePoolStates"];
	messageFactory: DexLoopInterface["messageFactory"];
	ammArb: DexLoopInterface["ammArb"];
	orderbookArb: DexLoopInterface["orderbookArb"]; // CACHE VALUES
	totalBytes = 0;
	mempool!: Mempool;
	ignoreAddresses!: IgnoredAddresses;
	blockHeight = 0;
	subscription!: Subscription;
	tmWebsocket!: WebSocket;
	txHistory: { [key: string]: boolean } = {};

	/**
	 *
	 */
	public constructor(
		chainOperator: ChainOperator,
		botConfig: DexConfig,
		logger: Logger | undefined,
		allPools: Array<Pool>,
		orderbooks: Array<Orderbook>,
		updateState: (chainOperator: ChainOperator, pools: Array<Pool>) => Promise<void>,
		messageFactory: DexLoopInterface["messageFactory"],
	) {
		const paths = getAmmPaths(allPools, botConfig);

		const orderbookPaths = getOrderbookAmmPaths(allPools, orderbooks, botConfig);
		const filteredPools = removedUnusedPools(allPools, paths, orderbookPaths);
		console.log(`all pools: ${allPools.length}, filtered pools: ${filteredPools.length}`);
		const filteredOrderbooks = removedUnusedOrderbooks(orderbooks, orderbookPaths);
		this.orderbookPaths = orderbookPaths;
		this.pools = filteredPools;
		this.orderbooks = filteredOrderbooks;
		this.CDpaths = new Map<
			string,
			{ timeoutIteration: number; timeoutDuration: number; path: OrderbookPath | Path }
		>();
		this.paths = paths;
		this.ammArb = tryAmmArb;
		this.orderbookArb = tryOrderbookArb;
		this.updatePoolStates = updateState;
		this.messageFactory = messageFactory;
		this.chainOperator = chainOperator;
		this.botConfig = botConfig;
		this.logger = logger;
		this.ignoreAddresses = botConfig.ignoreAddresses ?? {};
	}

	newTxListener: Listener<SubscriptionEvent> = {
		/**
		 *
		 */
		next: async (e) => {
			this.iterations++;
			flushTxMemory();
			console.log(e.data.value["block"]["header"]["height"]);
			for (const tx of e.data.value["block"]["data"]["txs"]) {
				const txBytes = fromBase64(tx);
				const txRaw = decodeTxRaw(txBytes);
				for (const msg of txRaw.body.messages) {
					if (
						[
							"/injective.wasmx.v1.MsgExecuteContractCompat",
							"/cosmwasm.wasm.v1.MsgExecuteContract",
						].includes(msg.typeUrl)
					) {
						console.log("updating pool states");
						await this.updatePoolStates(this.chainOperator, this.pools);

						return;
					}
				}
			}
			return;
		},
		/**
		 *
		 */
		error: (err: any) => console.log(err),
		/**
		 *
		 */
		complete: () => console.log("completed"),
	};
	/**
	 *
	 */
	newTxCallback = (newTx: TxEvent) => {
		console.log(newTx);
	};
	/**
	 *
	 */
	orderbookCallback = async (
		orderbookUpdate: ReturnType<typeof IndexerSpotStreamTransformer.orderbookV2StreamCallback>,
	) => {
		console.time("new ob");
		this.iterations++;
		const orderbook = this.orderbooks.find((ob) => ob.marketId === orderbookUpdate.marketId);
		if (!orderbook) {
			return;
		}
		if (!orderbookUpdate.orderbook) {
			return;
		}
		orderbook.buys = [];
		orderbook.sells = [];
		const decimalAdjustment: number = orderbook.baseAssetDecimals - orderbook.quoteAssetDecimals;

		for (const buy of orderbookUpdate.orderbook.buys) {
			const buyOrder: Order = {
				quantity: +buy.quantity / 10 ** decimalAdjustment,
				price: +buy.price * 10 ** decimalAdjustment,
				type: "buy",
			};
			orderbook.buys.push(buyOrder);
		}
		for (const sell of orderbookUpdate.orderbook.sells) {
			const sellOrder: Order = {
				quantity: +sell.quantity / 10 ** decimalAdjustment,
				price: +sell.price * 10 ** decimalAdjustment,
				type: "sell",
			};
			orderbook.sells.push(sellOrder);
		}
		await this.updatePoolStates(this.chainOperator, this.pools);
		console.timeEnd("new ob");
		const arbTrade = this.ammArb(this.paths, this.botConfig);
		const arbTradeOB = this.orderbookArb(this.orderbookPaths, this.botConfig);

		if (arbTrade && arbTradeOB) {
			if (arbTrade.profit > arbTradeOB.profit) {
				await this.trade(arbTrade);
			} else if (arbTrade.profit <= arbTradeOB.profit) {
				await this.trade(arbTradeOB);
			}
		} else if (arbTrade) {
			await this.trade(arbTrade);
		} else if (arbTradeOB) {
			await this.trade(arbTradeOB);
		}
	};
	/**
	 *
	 */
	public async step() {
		console.log("start");
		// this.subscription = this.chainOperator.streamOrderbooks(
		// 	this.orderbooks.map((ob) => ob.marketId),
		// 	this.orderbookCallback,
		// );
		const mempoolJsonRequest = createJsonRpcRequest("unconfirmed_txs", { limit: "100" });
		/**
		 *
		 */
		const mempoolQuerier = (ws: WebSocket) => {
			ws.send(JSON.stringify(mempoolJsonRequest));
			setTimeout(() => mempoolQuerier(ws), 100);
		};
		this.tmWebsocket = new WebSocket(
			this.botConfig.rpcUrls[0].replace("http://", "ws://").replace("https://", "wss://") + "/websocket",
		);

		this.tmWebsocket.on("error", (err) => {
			console.log(err);
		});
		this.tmWebsocket.on("message", async (data) => {
			const payLoad = JSON.parse(data.toString()).result;
			if (payLoad["n_txs" as keyof typeof payLoad]) {
				this.mempool = <Mempool>payLoad;
				await this.internalStep();
			} else if (payLoad["query" as keyof typeof payLoad]) {
				this.iterations++;
				flushTxMemory();
				for (const tx of payLoad.data.value["block"]["data"]["txs"]) {
					const txBytes = fromBase64(tx);
					const txRaw = decodeTxRaw(txBytes);
					for (const msg of txRaw.body.messages) {
						if (
							[
								"/injective.wasmx.v1.MsgExecuteContractCompat",
								"/cosmwasm.wasm.v1.MsgExecuteContract",
							].includes(msg.typeUrl)
						) {
							await this.updatePoolStates(this.chainOperator, this.pools);
							const arbTrade = this.ammArb(this.paths, this.botConfig);
							if (arbTrade) {
								await this.trade(arbTrade);
							}
							return;
						}
					}
				}
				return;
			}
		});

		this.tmWebsocket.on("open", () => {
			const jr = createJsonRpcRequest("subscribe", { query: "tm.event='NewBlock'" });
			this.tmWebsocket.send(JSON.stringify(jr));
			mempoolQuerier(this.tmWebsocket);
		});
	}

	// while (true) {
	// 	await delay(1000);
	// 	//do nothing
	// }
	// const wsc = new WebsocketClient(
	// 	this.botConfig.rpcUrls[0].replace("http://", "ws://").replace("https://", "wss://"),
	// );
	// const jr = createJsonRpcRequest("subscribe", { query: "tm.event='NewBlock'" });
	// const streamor = wsc.listen(jr);

	// streamor.addListener(this.newTxListener);

	// while (true) {
	// 	this.mempool = <Mempool>(await wsc.execute(createJsonRpcRequest("unconfirmed_txs"))).result;
	/**
	 *
	 */
	async internalStep() {
		if (+this.mempool.total_bytes === this.totalBytes) {
			return;
		} else {
			this.totalBytes = +this.mempool.total_bytes;
		}
		const mempoolTxs: Array<MempoolTx> = decodeMempool(
			this.mempool,
			this.ignoreAddresses,
			this.botConfig.timeoutDuration,
			this.iterations,
		);

		// Checks if there is a SendMsg from a blacklisted Address, if so add the reciever to the timeouted addresses
		if (mempoolTxs.length === 0) {
			return;
		} else {
			applyMempoolMessagesOnPools(this.pools, mempoolTxs);
		}

		const arbTrade = this.ammArb(this.paths, this.botConfig);
		if (arbTrade) {
			await this.trade(arbTrade);
		}
	}

	/**
	 *
	 */
	async reset() {
		await this.chainOperator.reset();
		this.unCDPaths();
		this.totalBytes = 0;
		flushTxMemory();
		await this.step();
	}

	/**
	 *
	 */
	public async trade(trade: Trade) {
		if (this.subscription) {
			this.subscription.unsubscribe();
		}

		if (this.tmWebsocket) {
			console.log(this.tmWebsocket.CLOSED);
			this.tmWebsocket.close();
			console.log(this.tmWebsocket.CLOSED);
		}
		if (trade.tradeType === TradeType.AMM) {
			await this.tradeAmm(<OptimalTrade>trade);
		} else if (trade.tradeType === TradeType.COMBINED) {
			await this.tradeOrderbook(<OptimalOrderbookTrade>trade);
		}
		this.cdPaths(trade.path);

		await delay(5000);
		await this.reset();
	}

	/**
	 *
	 */
	private async tradeOrderbook(arbTradeOB: OptimalOrderbookTrade) {
		const messages = this.messageFactory(
			arbTradeOB,
			this.chainOperator.client.publicAddress,
			this.botConfig.flashloanRouterAddress,
		);
		if (!messages) {
			console.error("error in creating messages", 1);
			process.exit(1);
		}
		const txResponse = await this.chainOperator.signAndBroadcast([messages[0][0]], arbTradeOB.path.fee);
		await this.logger?.tradeLogging.logOrderbookTrade(arbTradeOB, txResponse);
	}

	/**
	 *
	 */
	private async tradeAmm(arbTrade: OptimalTrade) {
		const messages = this.messageFactory(
			arbTrade,
			this.chainOperator.client.publicAddress,
			this.botConfig.flashloanRouterAddress,
		);
		if (!messages) {
			console.error("error in creating messages", 1);
			process.exit(1);
		}
		const txResponse = await this.chainOperator.signAndBroadcast(messages[0], arbTrade.path.fee);

		await this.logger?.tradeLogging.logAmmTrade(arbTrade, txResponse);
	}

	/**
	 * Put path on Cooldown, add to CDPaths with iteration number as block.
	 * Updates the iteration count of elements in CDpaths if its in equalpath of param: path
	 * Updates this.Path.
	 */
	public cdPaths(path: Path | OrderbookPath) {
		//add equalpaths to the CDPath array
		for (const equalpath of path.equalpaths) {
			this.CDpaths.set(equalpath.identifier, {
				timeoutIteration: this.iterations,
				timeoutDuration: 5,
				path: equalpath,
			});
		}
		//add self to the CDPath array
		this.CDpaths.set(path.identifier, { timeoutIteration: this.iterations, timeoutDuration: 10, path: path });

		//remove all paths on cooldown from active paths
		this.paths = this.paths.filter((pathToCheck) => this.CDpaths.get(pathToCheck.identifier) === undefined);

		//remove all orderbookpaths on cooldown from active orderbookpaths
		this.orderbookPaths = this.orderbookPaths.filter(
			(pathToCheck) => this.CDpaths.get(pathToCheck.identifier) === undefined,
		);
	}

	/** Removes the CD Paths if CD iteration number of path + Cooldownblocks <= this.iterations.
	 */
	public unCDPaths() {
		this.CDpaths.forEach((value, key) => {
			// if time set to cooldown (in iteration numbers) + cooldown amount < current iteration, remove it from cd
			if (value.timeoutIteration + value.timeoutDuration < this.iterations) {
				this.CDpaths.delete(key);
				//add the path back to active paths
				if (isOrderbookPath(value.path)) {
					this.orderbookPaths.push(value.path);
				} else {
					this.paths.push(value.path);
				}
			}
		});
	}

	/**
	 *
	 */
	public clearIgnoreAddresses() {
		const keys = Object.keys(this.ignoreAddresses);
		for (let i = 0; i < keys.length; i++) {
			if (
				this.ignoreAddresses[keys[i]].timeoutAt > 0 &&
				this.ignoreAddresses[keys[i]].timeoutAt + this.ignoreAddresses[keys[i]].duration <= this.iterations
			) {
				delete this.ignoreAddresses[keys[i]];
			}
		}
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
