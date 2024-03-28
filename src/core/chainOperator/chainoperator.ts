import { JsonObject } from "@cosmjs/cosmwasm-stargate";
import { EncodeObject } from "@cosmjs/proto-signing";
import { StdFee } from "@cosmjs/stargate";
import { Network } from "@injectivelabs/networks";
import { QueryContractInfoResponse } from "cosmjs-types/cosmwasm/wasm/v1/query";

import { BotConfig } from "../types/base/configs";
import CosmjsAdapter from "./chainAdapters/cosmjs";
import InjectiveAdapter from "./chainAdapters/injective";
import { TxResponse } from "./chainOperatorInterface";
/**
 *
 */
export class ChainOperator {
	client: CosmjsAdapter | InjectiveAdapter;
	network: string;

	/**
	 *
	 */
	constructor(client: CosmjsAdapter | InjectiveAdapter, network: string) {
		this.client = client;
		this.network = network;
	}
	/**
	 *
	 */
	static async connectWithSigner(botConfig: BotConfig): Promise<ChainOperator> {
		if (botConfig.chainPrefix.includes("inj")) {
			const injectiveClient = new InjectiveAdapter(botConfig, Network.Mainnet);
			await injectiveClient.init(botConfig);
			return new Promise((resolve, reject) => {
				resolve(new ChainOperator(injectiveClient, Network.Mainnet));
			});
		}

		const cosmjsClient = new CosmjsAdapter(botConfig);
		await cosmjsClient.init(botConfig);
		return new Promise((resolve, reject) => {
			resolve(new ChainOperator(cosmjsClient, botConfig.rpcUrls[0]));
		});
	}
	/**
	 *
	 */
	async queryContractSmart(address: string, queryMsg: Record<string, unknown>): Promise<JsonObject> {
		try {
			return await this.client.queryContractSmart(address, queryMsg);
		} catch (e: any) {
			//custom error for initPools JunoSwapPoolState
			if (e.message.includes("unknown variant `pool`,")) {
				throw new Error(e.message);
			}
			console.log(e);
			await this.client.getNewClients();
			await this.client.queryContractSmart(address, queryMsg);
		}
	}

	/**
	 *
	 */
	async queryMempool() {
		try {
			return await this.client.queryMempool();
		} catch (e) {
			console.log(e);
			await this.client.getNewClients();
			return await this.client.queryMempool();
		}
	}

	/**
	 *
	 */
	async queryContractInfo(address: string): Promise<QueryContractInfoResponse> {
		return await this.client.queryContractInfo(address);
	}
	/**
	 *
	 */
	async queryBlockheight() {
		return this.client.queryBlockHeight();
	}
	/**
	 *
	 */
	// async queryOrderbooks(marketids: Array<string>) {
	// 	return this.client.queryOrderbook(marketids);
	// }
	/**
	 *
	 */
	async queryOrderbook(marketId: string) {
		return this.client.queryOrderbook(marketId);
	}

	/**
	 *
	 */
	async queryOrderbooks(marketIds: Array<string>) {
		return this.client.queryOrderbooks(marketIds);
	}
	/**
	 *
	 */
	async queryMarket(marketId: string) {
		return this.client.queryMarket(marketId);
	}
	/**
	 *
	 */
	async signAndBroadcast(
		msgs: Array<EncodeObject>,
		fee?: StdFee | "auto",
		memo?: string | undefined,
	): Promise<TxResponse> {
		try {
			return await this.client.signAndBroadcast(msgs, fee, memo);
		} catch (e) {
			console.log(e);
			await this.client.getNewClients();
			return await this.client.signAndBroadcast(msgs, fee, memo);
		}
	}

	/**
	 *
	 */
	async reset() {
		return await this.client.reset();
	}
}
