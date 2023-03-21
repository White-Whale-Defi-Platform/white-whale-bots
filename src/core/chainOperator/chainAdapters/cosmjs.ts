import { JsonObject, setupWasmExtension, SigningCosmWasmClient, WasmExtension } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet, EncodeObject } from "@cosmjs/proto-signing";
import { AccountData } from "@cosmjs/proto-signing/build/signer";
import { GasPrice, QueryClient, setupAuthExtension } from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { HttpBatchClient, HttpClient } from "@cosmjs/tendermint-rpc/build/rpcclients";

import { BotConfig } from "../../types/base/botConfig";
import { ChainOperatorInterface, TxResponse } from "../chainOperatorInterface";

/**
 *
 */
class CosmjsAdapter implements ChainOperatorInterface {
	signingCWClient!: SigningCosmWasmClient; //used to sign transactions
	tmClient!: Tendermint34Client; //used to broadcast transactions
	httpClient: HttpBatchClient | HttpClient; //used to query rpc methods (unconfirmed_txs, account)
	wasmQueryClient!: QueryClient & WasmExtension; //used to query wasm methods (contract states)
	account!: AccountData;
	publicAddress!: string;
<<<<<<< HEAD
	accountNumber = 0;
	sequence = 0;
=======
>>>>>>> 44f02fa (feat: injectiveclient abstraction)

	/**
	 *
	 */
	constructor(botConfig: BotConfig) {
		this.httpClient = new HttpBatchClient(botConfig.rpcUrl);
	}
	/**
	 *
	 */
	async init(botConfig: BotConfig) {
		// derive signing wallet
		const signer = await DirectSecp256k1HdWallet.fromMnemonic(botConfig.mnemonic, {
			prefix: botConfig.chainPrefix,
		});
<<<<<<< HEAD

=======
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
		// connect to client and querier
		this.signingCWClient = await SigningCosmWasmClient.connectWithSigner(botConfig.rpcUrl, signer, {
			prefix: botConfig.chainPrefix,
			gasPrice: GasPrice.fromString(botConfig.gasPrice + botConfig.baseDenom),
		});
		this.httpClient = new HttpBatchClient(botConfig.rpcUrl);
		this.tmClient = await Tendermint34Client.create(this.httpClient);
		this.wasmQueryClient = QueryClient.withExtensions(this.tmClient, setupWasmExtension, setupAuthExtension);
		this.account = (await signer.getAccounts())[0];
<<<<<<< HEAD
		const { accountNumber, sequence } = await this.signingCWClient.getSequence(this.account.address);
		this.accountNumber = accountNumber;
		this.sequence = sequence;
=======
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
		this.publicAddress = this.account.address;
	}
	/**
	 *
	 */
	async queryContractSmart(address: string, queryMsg: Record<string, unknown>): Promise<JsonObject> {
		return await this.signingCWClient.queryContractSmart(address, queryMsg);
	}
	/**
	 *
	 */
	async signAndBroadcast(
		senderAddress: string,
		msgs: Array<EncodeObject>,
		memo?: string | undefined,
	): Promise<TxResponse> {
		return await this.signingCWClient.signAndBroadcast(senderAddress, msgs, "auto", memo);
	}
}

export default CosmjsAdapter;
