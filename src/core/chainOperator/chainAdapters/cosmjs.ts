import { JsonObject, setupWasmExtension, SigningCosmWasmClient, WasmExtension } from "@cosmjs/cosmwasm-stargate";
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
	skipBundleClient?: SkipBundleClient;
	rpcUrls!: Array<string>;
	timeoutRPCs!: Map<string, number>;
	chainPrefix!: string;
	denom!: string;
	gasPrice!: string;

	/**
	 *
	 */
	constructor(botConfig: BotConfig) {
		this.timeoutRPCs = new Map<string, number>
		this.httpClient = new HttpBatchClient(botConfig.rpcUrls[0]);
		if (botConfig.skipConfig) {
			this.skipBundleClient = new SkipBundleClient(botConfig.skipConfig.skipRpcUrl);
		}
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
		this.rpcUrls = botConfig.rpcUrls;
		this.chainPrefix = botConfig.chainPrefix;
		this.denom = botConfig.baseDenom;
		this.gasPrice = botConfig.gasPrice;

		// connect to client and querier
		await this.getClients(botConfig.rpcUrls[0]);
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
	async getClients(rpcUrl: string) {
		this.httpClient = new HttpBatchClient(rpcUrl);
		this.tmClient = await Tendermint34Client.create(this.httpClient);
		this.wasmQueryClient = QueryClient.withExtensions(this.tmClient, setupWasmExtension, setupAuthExtension);
		this.signingCWClient = await SigningCosmWasmClient.connectWithSigner(rpcUrl, this.signer, {
			prefix: this.chainPrefix,
			gasPrice: GasPrice.fromString(this.gasPrice + this.denom),
		});
	}
	/**
	 *
	 */
	async queryContractSmart(address: string, queryMsg: Record<string, unknown>): Promise<JsonObject> {
		return await this.wasmQueryClient.wasm.queryContractSmart(address, queryMsg);
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
			console.log(res);
			return {
				height: 0,
				code: res.code,
				transactionHash: res.hash.toString(),
				rawLog: res.log,
			};
		}
	}
	/**
	 *
	 */
	async signAndBroadcastSkipBundle(messages: Array<EncodeObject>, fee: StdFee, memo?: string, otherTx?: TxRaw) {
		if (!this.skipBundleClient) {
			console.log("skip bundle client not initialised");
			process.exit(1);
		}

		const signerData = {
			accountNumber: this.accountNumber,
			sequence: this.sequence,
			chainId: this.chainId,
		};
		const txRaw: TxRaw = await this.signingCWClient.sign(this.publicAddress, messages, fee, "", signerData);

		let signed;
		if (otherTx) {
			signed = await this.skipBundleClient.signBundle([otherTx, txRaw], this.signer, this.publicAddress);
		} else {
			signed = await this.skipBundleClient.signBundle([txRaw], this.signer, this.publicAddress);
		}
		const res = await this.skipBundleClient.sendBundle(signed, 0, true);
		return res;
	}

	/**
	 *
	 */
	async queryMempool(): Promise<Mempool> {
		const mempoolResult = await this.httpClient.execute(createJsonRpcRequest("unconfirmed_txs"));
		return mempoolResult.result;
	}

	/**
	 * Sets new Clients for Mempoolloop.
	 *
	 */
	public async getNewClients(): Promise<string | void> {
		//await this.logger?.sendMessage("Error: \n" + String(errmsg), LogType.All);
		let out: string
		const TIMEOUTDUR = 60000; // 10 Min timeout if error
		let n = 0;
		let urlString: string | undefined;
		this.timeoutRPCs.set(this.httpClient.url, Date.now());
		while (!urlString && n < this.rpcUrls.length) {
			const currTime: number = Date.now();

			if (!this.timeoutRPCs.has(this.rpcUrls[n])) {
				urlString = this.rpcUrls[n];
			} else {
				const errTime = this.timeoutRPCs.get(this.rpcUrls[n]);
				if (errTime && errTime + TIMEOUTDUR <= currTime) {
					this.timeoutRPCs.delete(this.rpcUrls[n]);
					urlString = this.rpcUrls[n];
				}
			}
			n++;
		}
		if (!urlString) {
			//await this.logger?.sendMessage("All RPC's Timeouted", LogType.Console);
			let n: number = Date.now();
			let nextUrl: string = this.httpClient.url;
			for (const [url, timeouted] of this.timeoutRPCs.entries()) {
				if (timeouted < n) {
					n = timeouted;
					nextUrl = url;
				}
			}
			await delay(TIMEOUTDUR + n - Date.now());
			await this.getClients(nextUrl);
			out = nextUrl
		} else {
			//await this.logger?.sendMessage("Updating Clients to: " + urlString, LogType.All);
			await this.getClients(urlString);
			out = urlString
		}
		//await this.logger?.sendMessage("Continue...", LogType.Console);
		return out;
	}
}
/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export default CosmjsAdapter;
