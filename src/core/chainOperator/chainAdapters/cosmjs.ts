import { JsonObject, setupWasmExtension, SigningCosmWasmClient, WasmExtension } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet, EncodeObject } from "@cosmjs/proto-signing";
import { AccountData } from "@cosmjs/proto-signing/build/signer";
import { BroadcastTxError, GasPrice, QueryClient, setupAuthExtension, StdFee } from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { HttpBatchClient, HttpClient } from "@cosmjs/tendermint-rpc/build/rpcclients";
import { SkipBundleClient } from "@skip-mev/skipjs";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { BotConfig } from "../../types/base/configs";
import { Mempool } from "../../types/base/mempool";
import { ChainOperatorInterface, TxResponse } from "../chainOperatorInterface";

/**
 *
 */
class CosmjsAdapter implements ChainOperatorInterface {
	private _signingCWClient!: SigningCosmWasmClient; //used to sign transactions
	private _tmClient!: Tendermint34Client; //used to broadcast transactions
	private _httpClient!: HttpBatchClient | HttpClient; //used to query rpc methods (unconfirmed_txs, account)
	private _wasmQueryClient!: QueryClient & WasmExtension; //used to query wasm methods (contract states)
	private _account!: AccountData;
	private _publicAddress!: string;
	private _accountNumber = 0;
	private _sequence = 0;
	private _chainPrefix: string;
	private _chainId!: string;
	private _signer!: DirectSecp256k1HdWallet;
	private _skipBundleClient?: SkipBundleClient;
	private _timeoutRPCs: Map<string, number>;
	private _subaccountId!: string;
	private _rpcUrls!: Array<string>;
	private _denom!: string;
	private _gasPrice!: number;
	private _currRpcUrl: string;

	/**
	 *
	 */
	constructor(botConfig: BotConfig) {
		this._chainPrefix = botConfig.chainPrefix;
		this._timeoutRPCs = new Map<string, number>();
		this._currRpcUrl = botConfig.rpcUrls[0];
		if (botConfig.skipConfig) {
			this._skipBundleClient = new SkipBundleClient(botConfig.skipConfig.skipRpcUrl);
		}
		this._rpcUrls = botConfig.rpcUrls;
		this._denom = botConfig.baseDenom;
		this._gasPrice = botConfig.gasPrice;
		this.subaccountId = "";
	}
	/**
	 *
	 */
	public set subaccountId(value) {
		this._subaccountId = value;
	}
	/**
	 *
	 */
	public get subaccountId(): string {
		return this._subaccountId;
	}
	/**
	 *
	 */
	public get sequence() {
		return this._sequence;
	}
	/**
	 *
	 */
	public set sequence(value) {
		this._sequence = value;
	}
	/**
	 *
	 */
	public get publicAddress(): string {
		return this._publicAddress;
	}
	/**
	 *
	 */
	public set publicAddress(value) {
		this._publicAddress = value;
	}
	/**
	 *
	 */
	public get chainId(): string {
		return this._chainId;
	}
	/**
	 *
	 */
	async init(botConfig: BotConfig) {
		// derive signing wallet
		this._signer = await DirectSecp256k1HdWallet.fromMnemonic(botConfig.mnemonic, {
			prefix: botConfig.chainPrefix,
		});
		// connect to client and querier
		await this.setClients(botConfig.rpcUrls[0]);
		this._account = (await this._signer.getAccounts())[0];
		const { accountNumber, sequence } = await this._signingCWClient.getSequence(this._account.address);
		this._chainId = await this._signingCWClient.getChainId();
		this._accountNumber = accountNumber;
		this.sequence = sequence;
		this.publicAddress = this._account.address;
	}

	/**
	 *
	 */
	async setClients(rpcUrl: string) {
		this._httpClient = new HttpBatchClient(rpcUrl);
		this._tmClient = await Tendermint34Client.create(this._httpClient);
		this._wasmQueryClient = QueryClient.withExtensions(this._tmClient, setupWasmExtension, setupAuthExtension);
		this._signingCWClient = await SigningCosmWasmClient.connectWithSigner(rpcUrl, this._signer, {
			gasPrice: GasPrice.fromString(this._gasPrice + this._denom),
		});
	}
	/**
	 *
	 */
	async queryContractSmart(address: string, queryMsg: Record<string, unknown>): Promise<JsonObject> {
		return await this._wasmQueryClient.wasm.queryContractSmart(address, queryMsg);
	}
	/**
	 *
	 */
	async signAndBroadcast(
		msgs: Array<EncodeObject>,
		fee: StdFee | "auto" = "auto",
		memo?: string | undefined,
	): Promise<TxResponse> {
		try {
			if (fee === "auto") {
				return await this._signingCWClient.signAndBroadcast(this.publicAddress, msgs, fee, memo);
			} else {
				const signerData = {
					accountNumber: this._accountNumber,
					sequence: this._sequence,
					chainId: this._chainId,
				};
				const txRaw = await this._signingCWClient.sign(this.publicAddress, msgs, fee, "memo", signerData);
				const txBytes = TxRaw.encode(txRaw).finish();
				const res = await this._tmClient.broadcastTxSync({ tx: txBytes });

				return {
					height: 0,
					code: res.code,
					transactionHash: res.hash.toString(),
					rawLog: res.log,
				};
			}
		} catch (e) {
			if (e instanceof BroadcastTxError) {
				console.log("error in broadcasting:\n");
				console.log(e.message);
				return {
					height: 0,
					code: e.code,
					transactionHash: "",
					rawLog: e.log,
				};
			}
		}
		return {
			height: 0,
			code: 1,
			transactionHash: "",
			rawLog: "",
		};
	}
	/**
	 *
	 */
	async signAndBroadcastSkipBundle(messages: Array<EncodeObject>, fee: StdFee, memo?: string, otherTx?: TxRaw) {
		if (!this._skipBundleClient) {
			console.log("skip bundle client not initialised");
			process.exit(1);
		}

		const signerData = {
			accountNumber: this._accountNumber,
			sequence: this._sequence,
			chainId: this._chainId,
		};
		const txRaw: TxRaw = await this._signingCWClient.sign(this.publicAddress, messages, fee, "", signerData);

		let signed;
		if (otherTx) {
			signed = await this._skipBundleClient.signBundle([otherTx, txRaw], this._signer, this.publicAddress);
		} else {
			signed = await this._skipBundleClient.signBundle([txRaw], this._signer, this.publicAddress);
		}
		const res = await this._skipBundleClient.sendBundle(signed, 0, true);
		return res;
	}

	/**
	 *
	 */
	async queryMempool(): Promise<Mempool> {
		const mempoolResult = await this._httpClient.execute(createJsonRpcRequest("unconfirmed_txs"));
		return mempoolResult.result;
	}
	/**
	 *
	 */
	async queryBlockHeight() {
		const blockResponse = await this._httpClient.execute(createJsonRpcRequest("block"));
		return blockResponse.result.block.header.height;
	}

	/**
	 * Sets new Clients for Mempoolloop.
	 *
	 */
	public async getNewClients(): Promise<string | void> {
		let out: string;
		const TIMEOUTDUR = 60000; // 10 Min timeout if error
		let n = 0;
		let urlString: string | undefined;
		this._timeoutRPCs.set(this._currRpcUrl, Date.now());
		while (!urlString && n < this._rpcUrls.length) {
			const currTime: number = Date.now();

			if (!this._timeoutRPCs.has(this._rpcUrls[n])) {
				urlString = this._rpcUrls[n];
			} else {
				const errTime = this._timeoutRPCs.get(this._rpcUrls[n]);
				if (errTime && errTime + TIMEOUTDUR <= currTime) {
					this._timeoutRPCs.delete(this._rpcUrls[n]);
					urlString = this._rpcUrls[n];
				}
			}
			n++;
		}
		if (!urlString) {
			console.log("All RPC's Timeouted");
			let n: number = Date.now();
			let nextUrl: string = this._currRpcUrl;
			for (const [url, timeouted] of this._timeoutRPCs.entries()) {
				if (timeouted < n) {
					n = timeouted;
					nextUrl = url;
				}
			}
			await delay(TIMEOUTDUR + n - Date.now());
			await this.setClients(nextUrl);
			out = nextUrl;
		} else {
			console.log("Updating Clients to: " + urlString);
			await this.setClients(urlString);
			out = urlString;
		}
		console.log("Continue...");
		this._currRpcUrl = out;
	}
	/**
	 *
	 */
	public async queryOrderbook() {
		console.log("orderbook query not yet implemented for cosmjs");
	}

	/**
	 *
	 */
	public async queryOrderbooks(marketIds: Array<string>) {
		console.log("orderbook query not yet implemented for cosmjs");
	}
	/**
	 *
	 */
	async queryOrderbookOrders(marketId: string, subaccountId: string = this.subaccountId) {
		console.log("orderbook query not yet implemented for cosmjs");
	}
	/**
	 *
	 */
	async queryMarket(marketId: string) {
		console.log("market query not yet implemented for cosmjs");
	}
	/**
	 *
	 */
	async reset(): Promise<void> {
		const { accountNumber, sequence } = await this._signingCWClient.getSequence(this._account.address);
		this._accountNumber = accountNumber;
		this._sequence = sequence;
	}
}
/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export default CosmjsAdapter;
