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
			const injectiveClient = new InjectiveAdapter(botConfig, Network.MainnetK8s);
			await injectiveClient.init(botConfig);
			return new Promise((resolve, reject) => {
				resolve(new ChainOperator(injectiveClient, Network.MainnetK8s));
			});
		}

		const cosmjsClient = new CosmjsAdapter(botConfig);
		await cosmjsClient.init(botConfig);
		return new Promise((resolve, reject) => {
			resolve(new ChainOperator(cosmjsClient, botConfig.rpcUrl));
		});
	}
	/**
	 *
	 */
	async queryContractSmart(address: string, queryMsg: Record<string, unknown>): Promise<JsonObject> {
		return await this.client.queryContractSmart(address, queryMsg);
	}

	/**
	 *
	 */
	async queryMempool() {
		return await this.client.queryMempool();
	}
	/**
	 *
	 */
	async signAndBroadcast(
		msgs: Array<EncodeObject>,
		fee?: StdFee | "auto",
		memo?: string | undefined,
	): Promise<TxResponse> {
		return await this.client.signAndBroadcast(msgs, fee, memo);
	}
	/**
	 *
	 */
	async signAndBroadcastSkipBundle(messages: Array<EncodeObject>, fee: StdFee, memo?: string, otherTx?: TxRaw) {
		return await this.client.signAndBroadcastSkipBundle(messages, fee, memo, otherTx);
	}
}
