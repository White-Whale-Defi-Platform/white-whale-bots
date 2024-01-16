import { JsonObject, setupWasmExtension, WasmExtension } from "@cosmjs/cosmwasm-stargate";
import { stringToPath } from "@cosmjs/crypto/build/slip10";
import { DirectSecp256k1HdWallet, EncodeObject } from "@cosmjs/proto-signing";
import { QueryClient, StdFee } from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { HttpBatchClient } from "@cosmjs/tendermint-rpc";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { TransactionException } from "@injectivelabs/exceptions/dist/cjs/exceptions/TransactionException";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import {
	BaseAccount,
	ChainRestAuthApi,
	createTransaction,
	IndexerGrpcSpotApi,
	MsgBroadcasterWithPk,
	MsgCreateSpotMarketOrder,
	MsgExecuteContract,
	MsgSend,
	OrderbookWithSequence,
	PrivateKey,
	PublicKey,
	SpotMarket,
} from "@injectivelabs/sdk-ts";
import { ChainId } from "@injectivelabs/ts-types";
import { SkipBundleClient } from "@skip-mev/skipjs";
import { MsgSend as CosmJSMsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { MsgExecuteContract as CosmJSMsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { BotConfig } from "../../types/base/configs";
import { Mempool } from "../../types/base/mempool";
import { ChainOperatorInterface, TxResponse } from "../chainOperatorInterface";
/**
 *
 */
class InjectiveAdapter implements ChainOperatorInterface {
	private _privateKey: PrivateKey;
	private _signAndBroadcastClient: MsgBroadcasterWithPk;
	private _spotQueryClient: IndexerGrpcSpotApi;
	private _wasmQueryClient!: QueryClient & WasmExtension; //used to query wasm methods (contract states)
	private _httpClient!: HttpBatchClient;
	private _authClient: ChainRestAuthApi;
	private _chainId: ChainId;

	private _publicKey: PublicKey;
	private _publicAddress!: string;

	private _signer!: DirectSecp256k1HdWallet;
	private _accountNumber = 0;
	private _sequence = 0;
	private _skipBundleClient?: SkipBundleClient;
	private _skipSigningAddress!: string;

	/**
	 *
	 */
	constructor(botConfig: BotConfig, network: Network = Network.Mainnet) {
		const endpoints = getNetworkEndpoints(network);
		const privateKey = PrivateKey.fromMnemonic(botConfig.mnemonic, "m/44'/60'/0'/0/0");
		this._privateKey = privateKey;
		this._signAndBroadcastClient = new MsgBroadcasterWithPk({
			network: network,
			privateKey: privateKey,
			endpoints: {
				indexer: endpoints.indexer,
				grpc: botConfig.grpcUrl ?? endpoints.grpc,
				rest: botConfig.restUrl ?? endpoints.rest,
			},
		});
		this._spotQueryClient = new IndexerGrpcSpotApi(endpoints.indexer);
		this._authClient = new ChainRestAuthApi(botConfig.restUrl ?? endpoints.rest);
		this._chainId = network === Network.TestnetK8s ? ChainId.Testnet : ChainId.Mainnet;
		this._publicKey = privateKey.toPublicKey();
		this.publicAddress = privateKey.toPublicKey().toAddress().address;
	}
	/**
	 *
	 */
	public get sequence(): number {
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
	public get chainId(): ChainId {
		return this._chainId;
	}

	/**
	 *
	 */
	async init(botConfig: BotConfig): Promise<void> {
		const accountDetailsResponse = await this._authClient.fetchAccount(this._publicAddress);
		const baseAccount = BaseAccount.fromRestApi(accountDetailsResponse);
		const accountDetails = baseAccount.toAccountDetails();
		this._accountNumber = accountDetails.accountNumber;
		this.sequence = accountDetails.sequence;

		await this.setClients(botConfig.rpcUrls[0]);
		const hdPath = stringToPath("m/44'/60'/0'/0/0");
		this._signer = await DirectSecp256k1HdWallet.fromMnemonic(botConfig.mnemonic, {
			prefix: botConfig.chainPrefix,
			hdPaths: [hdPath],
		});

		if (botConfig.skipConfig) {
			this._skipBundleClient = new SkipBundleClient(botConfig.skipConfig.skipRpcUrl);
			this._skipSigningAddress = (await this._signer.getAccounts())[0].address;
		}
		// const markets = await this._spotQueryClient.fetchMarkets();
		// for (const market of markets) {
		// 	console.log(market.marketId, market.baseDenom, market.quoteDenom, market.ticker);
		// }
	}
	/**
	 *
	 */
	async setClients(rpcUrl: string) {
		this._httpClient = new HttpBatchClient(rpcUrl);
		const tmClient = await Tendermint34Client.create(this._httpClient);
		this._wasmQueryClient = QueryClient.withExtensions(tmClient, setupWasmExtension);
		// this._signingCWClient = await SigningCosmWasmClient.connectWithSigner(rpcUrl, this._signer, {
		// 	gasPrice: GasPrice.fromString(this._gasPrice + this._denom),
		// });
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
	async queryBlockHeight() {
		const blockResponse = await this._httpClient.execute(createJsonRpcRequest("block"));
		return blockResponse.result.block.header.height;
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
	async queryOrderbook(marketId: string): Promise<OrderbookWithSequence> {
		return await this._spotQueryClient.fetchOrderbookV2(marketId);
	}

	/**
	 *
	 */
	async queryOrderbooks(marketIds: Array<string>): Promise<
		Array<{
			marketId: string;
			orderbook: OrderbookWithSequence;
		}>
	> {
		return await this._spotQueryClient.fetchOrderbooksV2(marketIds);
	}

	/**
	 *
	 */
	async queryMarket(marketId: string): Promise<SpotMarket> {
		return await this._spotQueryClient.fetchMarket(marketId);
	}

	/**
	 *
	 */
	async reset(): Promise<void> {
		const accountDetailsResponse = await this._authClient.fetchAccount(this._publicAddress);
		const baseAccount = BaseAccount.fromRestApi(accountDetailsResponse);
		const accountDetails = baseAccount.toAccountDetails();
		this._accountNumber = accountDetails.accountNumber;
		this._sequence = accountDetails.sequence;
	}
	/**
	 *
	 */
	async signAndBroadcast(messages: Array<EncodeObject>, fee?: StdFee | "auto", memo?: string): Promise<TxResponse> {
		const preppedMsgs = this.prepair(messages);
		if (!preppedMsgs) {
			console.log("cannot create txRaw from encodeMessage");
			process.exit(1);
		}
		try {
			if (!fee || fee === "auto") {
				const broadcasterOptions = {
					msgs: preppedMsgs,
				};
				const simRes = await this._signAndBroadcastClient.simulate(broadcasterOptions);
				const res = await this._signAndBroadcastClient.broadcast(broadcasterOptions);
				return {
					height: res.height,
					code: res.code,
					transactionHash: res.txHash,
					rawLog: res.rawLog,
				};
			} else {
				/*
				interface MsgBroadcasterTxOptions {
    msgs: Msgs | Msgs[];
    injectiveAddress: string;
    ethereumAddress?: string;
    memo?: string;
    feePrice?: string;
    feeDenom?: string;
    gasLimit?: number;
    };
}
				*/
				const broadcasterOptions = {
					msgs: preppedMsgs,
					gas: {
						gasPrice: String(+fee.amount[0].amount / +fee.gas),
						gas: +fee.gas,
					},
				};
				console.log(broadcasterOptions.gas);
				const res = await this._signAndBroadcastClient.broadcast(broadcasterOptions);
				return {
					height: res.height,
					code: res.code,
					transactionHash: res.txHash,
					rawLog: res.rawLog,
				};
			}
		} catch (e) {
			if (e instanceof TransactionException) {
				console.log("error in broadcasting:\n");
				console.log(e.message);
				return {
					height: 0,
					code: e.code,
					transactionHash: "",
					rawLog: e.originalMessage,
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
		if (!this._skipBundleClient || !this._skipSigningAddress) {
			console.log("skip bundle client not initialised");
			process.exit(1);
		}

		const preppedMsgs = this.prepair(messages);
		// console.log(inspect(preppedMsgs, { depth: null }));
		if (!preppedMsgs || preppedMsgs.length === 0) {
			return;
		}
		const { signBytes, txRaw, bodyBytes, authInfoBytes } = createTransaction({
			fee: fee,
			memo: memo,
			chainId: this._chainId,
			message: preppedMsgs,
			pubKey: this._publicKey.toBase64(),
			sequence: this._sequence,
			accountNumber: this._accountNumber,
		});
		const signature = await this._privateKey.sign(Buffer.from(signBytes));

		txRaw.signatures = [signature];
		const cosmTxRaw = {
			signatures: txRaw.signatures,
			bodyBytes: bodyBytes,
			authInfoBytes: authInfoBytes,
		};

		let signed;
		if (otherTx) {
			signed = await this._skipBundleClient.signBundle(
				[otherTx, cosmTxRaw],
				this._signer,
				this._skipSigningAddress,
			);
		} else {
			signed = await this._skipBundleClient.signBundle([cosmTxRaw], this._signer, this._skipSigningAddress);
		}
		const res = await this._skipBundleClient.sendBundle(signed, 0, true);
		return res;
	}
	/**
	 *
	 */
	private prepair(messages: Array<EncodeObject>) {
		try {
			const encodedExecuteMsgs: Array<MsgExecuteContract | MsgSend | MsgCreateSpotMarketOrder> = [];
			messages.map((msg, idx) => {
				if (msg.typeUrl === "/cosmwasm.wasm.v1.MsgExecuteContract") {
					const msgExecuteContract = <CosmJSMsgExecuteContract>msg.value;
					const msgUtf8 = msgExecuteContract.msg;
					const sender = msgExecuteContract.sender;
					const contract = msgExecuteContract.contract;
					const funds = msgExecuteContract.funds;

					const msgString = Buffer.from(msgUtf8).toString("utf8");
					const jsonMessage = JSON.parse(msgString);

					const [[action, msgs]] = Object.entries(jsonMessage);

					const isLPMessage = action?.includes("provide");

					const executeMessageJson = {
						action,
						msg: msgs as object,
					};
					// Provide LP: Funds isint being handled proper, before we were sending 1 coin, now we are sending it all but getting invalid coins
					const params = {
						funds: isLPMessage ? funds : funds?.[0],
						sender: this._publicAddress,

						contractAddress: contract,
						exec: executeMessageJson,
					};

					const MessageExecuteContract = MsgExecuteContract.fromJSON(params);

					encodedExecuteMsgs.push(MessageExecuteContract);
				}
				if (msg.typeUrl === "/cosmos.bank.v1beta1.MsgSend") {
					const msgSend = <CosmJSMsgSend>msg.value;
					const sender = msgSend.fromAddress;
					const receiver = msgSend.toAddress;
					const amount = msgSend.amount;

					const msgSendInjective = MsgSend.fromJSON({
						amount: {
							denom: amount[0].denom,
							amount: amount[0].amount,
						},
						srcInjectiveAddress: sender,
						dstInjectiveAddress: receiver,
					});

					encodedExecuteMsgs.push(msgSendInjective);
				}
				if (msg.typeUrl === "/injective.exchange.v1beta1.MsgCreateSpotMarketOrder") {
					encodedExecuteMsgs.push(msg.value);
				}
			});
			return encodedExecuteMsgs;
		} catch (error) {
			console.log(error);
		}
	}
	/**
	 * Sets new Clients for Mempoolloop.
	 * TODO!!!
	 */
	public async getNewClients() {
		throw new Error("Change Clients not implemented for Injective yet");
	}
}

export default InjectiveAdapter;
