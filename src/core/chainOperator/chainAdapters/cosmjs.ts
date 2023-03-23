import { JsonObject, setupWasmExtension, SigningCosmWasmClient, WasmExtension } from "@cosmjs/cosmwasm-stargate";
import { fromUtf8 } from "@cosmjs/encoding";
import { DirectSecp256k1HdWallet, EncodeObject } from "@cosmjs/proto-signing";
import { AccountData } from "@cosmjs/proto-signing/build/signer";
import { GasPrice, QueryClient, setupAuthExtension, StdFee } from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { HttpBatchClient, HttpClient } from "@cosmjs/tendermint-rpc/build/rpcclients";
import { SkipBundleClient } from "@skip-mev/skipjs";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { BotConfig } from "../../types/base/botConfig";
import { Mempool } from "../../types/base/mempool";
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
	accountNumber = 0;
	sequence = 0;
	chainId!: string;
	signer!: DirectSecp256k1HdWallet;

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
		this.signer = signer;

		// connect to client and querier
		this.signingCWClient = await SigningCosmWasmClient.connectWithSigner(botConfig.rpcUrl, signer, {
			prefix: botConfig.chainPrefix,
			gasPrice: GasPrice.fromString(botConfig.gasPrice + botConfig.baseDenom),
		});
		this.httpClient = new HttpBatchClient(botConfig.rpcUrl);
		this.tmClient = await Tendermint34Client.create(this.httpClient);
		this.wasmQueryClient = QueryClient.withExtensions(this.tmClient, setupWasmExtension, setupAuthExtension);
		this.account = (await signer.getAccounts())[0];
		const { accountNumber, sequence } = await this.signingCWClient.getSequence(this.account.address);
		this.chainId = await this.signingCWClient.getChainId();
		this.accountNumber = accountNumber;
		this.sequence = sequence;
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
		msgs: Array<EncodeObject>,
		fee: StdFee | "auto" = "auto",
		memo?: string | undefined,
	): Promise<TxResponse> {
		if (fee === "auto") {
			return await this.signingCWClient.signAndBroadcast(this.publicAddress, msgs, fee, memo);
		} else {
			const signerData = {
				accountNumber: this.accountNumber,
				sequence: this.sequence,
				chainId: this.chainId,
			};
			const txRaw = await this.signingCWClient.sign(this.publicAddress, msgs, fee, "memo", signerData);
			const txBytes = TxRaw.encode(txRaw).finish();
			const res = await this.tmClient.broadcastTxSync({ tx: txBytes });
			return {
				height: 0,
				code: res.code,
				transactionHash: fromUtf8(res.hash),
				rawLog: res.log,
			};
		}
	}
	/**
	 *
	 */
	async signAndBroadcastSkipBundle(messages: Array<EncodeObject>, fee: StdFee, memo?: string) {
		const signerData = {
			accountNumber: this.accountNumber,
			sequence: this.sequence,
			chainId: this.chainId,
		};
		const txRaw: TxRaw = await this.signingCWClient.sign(this.publicAddress, messages, fee, "", signerData);
		const skipBundleClient = new SkipBundleClient("https://injective-1-api.skip.money");

		const signed = await skipBundleClient.signBundle([txRaw], this.signer, this.publicAddress);
		const res = await skipBundleClient.sendBundle(signed, 0, true);
		return res;
	}

	/**
	 *
	 */
	async queryMempool(): Promise<Mempool> {
		const mempoolResult = await this.httpClient.execute(createJsonRpcRequest("unconfirmed_txs"));
		return mempoolResult.result;
	}
}

export default CosmjsAdapter;
