import { JsonObject } from "@cosmjs/cosmwasm-stargate";
import { EncodeObject } from "@cosmjs/proto-signing";
import { StdFee } from "@cosmjs/stargate";
import { Network } from "@injectivelabs/networks";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { BotConfig } from "../types/base/botConfig";
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
			if (e.message.includes("Query failed with (18):")) {
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
	/**
	 *
	 */
	async signAndBroadcastSkipBundle(messages: Array<EncodeObject>, fee: StdFee, memo?: string, otherTx?: TxRaw) {
		try {
			return await this.client.signAndBroadcastSkipBundle(messages, fee, memo, otherTx);
		} catch (e) {
			console.log(e);
			await this.client.getNewClients();
			return await this.client.signAndBroadcastSkipBundle(messages, fee, memo, otherTx);
		}
	}
}
