import { JsonObject } from "@cosmjs/cosmwasm-stargate";
import { stringToPath } from "@cosmjs/crypto/build/slip10";
import { fromBase64, fromUtf8 } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { StdFee } from "@cosmjs/stargate";
import { HttpBatchClient } from "@cosmjs/tendermint-rpc";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import {
	BaseAccount,
	ChainGrpcWasmApi,
	ChainRestAuthApi,
	createTransaction,
	getDefaultSubaccountId,
	IndexerGrpcSpotApi,
	MsgBroadcasterWithPk,
	MsgExecuteContract,
	MsgSend,
	PrivateKey,
	PublicKey,
} from "@injectivelabs/sdk-ts";
import { ChainId } from "@injectivelabs/ts-types";
import { SkipBundleClient } from "@skip-mev/skipjs";
import { MsgSend as CosmJSMsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { MsgExecuteContract as CosmJSMsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { inspect } from "util";

import { BotConfig } from "../../types/base/botConfig";
import { Mempool } from "../../types/base/mempool";
import { ChainOperatorInterface, TxResponse } from "../chainOperatorInterface";
/**
 *
 */
class InjectiveAdapter implements ChainOperatorInterface {
	privateKey: PrivateKey;
	signAndBroadcastClient: MsgBroadcasterWithPk;
	spotQueryClient: IndexerGrpcSpotApi;
	wasmQueryClient: ChainGrpcWasmApi;
	httpClient: HttpBatchClient;
	chainId: ChainId;
	network: Network;
	publicKey: PublicKey;
	publicAddress: string;
	ethereumAddress: string;
	subAccountId: string;
	signer!: DirectSecp256k1HdWallet;
	accountNumber = 0;
	sequence = 0;
	skipBundleClient?: SkipBundleClient;
	skipSigningAddress!: string;

	/**
	 *
	 */
	constructor(botConfig: BotConfig, network: Network = Network.MainnetK8s) {
		const endpoints = getNetworkEndpoints(network);
		const privateKey = PrivateKey.fromMnemonic(botConfig.mnemonic, "m/44'/60'/0'/0/0");
		this.privateKey = privateKey;
		this.signAndBroadcastClient = new MsgBroadcasterWithPk({
			network: network,
			privateKey: privateKey,
		});
		this.spotQueryClient = new IndexerGrpcSpotApi(endpoints.indexer);
		this.wasmQueryClient = new ChainGrpcWasmApi(endpoints.grpc);
		this.httpClient = new HttpBatchClient(botConfig.rpcUrl);
		this.chainId = network === Network.TestnetK8s ? ChainId.Testnet : ChainId.Mainnet;
		this.network = network;
		this.publicKey = privateKey.toPublicKey();
		this.publicAddress = privateKey.toPublicKey().toAddress().address;
		this.subAccountId = getDefaultSubaccountId(this.publicAddress);
		this.ethereumAddress = privateKey.toPublicKey().toAddress().getEthereumAddress();
	}
	/**
	 *
	 */
	async init(botConfig: BotConfig): Promise<void> {
		const restEndpoint = getNetworkEndpoints(this.network).rest;
		const chainRestAuthApi = new ChainRestAuthApi(restEndpoint);
		const accountDetailsResponse = await chainRestAuthApi.fetchAccount(this.publicAddress);
		const baseAccount = BaseAccount.fromRestApi(accountDetailsResponse);
		const accountDetails = baseAccount.toAccountDetails();
		this.accountNumber = accountDetails.accountNumber;
		this.sequence = accountDetails.sequence;

		const hdPath = stringToPath("m/44'/60'/0'/0/0");
		this.signer = await DirectSecp256k1HdWallet.fromMnemonic(botConfig.mnemonic, {
			prefix: botConfig.chainPrefix,
			hdPaths: [hdPath],
		});

		if (botConfig.skipConfig) {
			this.skipBundleClient = new SkipBundleClient(botConfig.skipConfig.skipRpcUrl);
			this.skipSigningAddress = (await this.signer.getAccounts())[0].address;
		}
	}
	/**
	 *
	 */
	async queryContractSmart(address: string, queryMsg: Record<string, unknown>): Promise<JsonObject> {
		const queryResult = await this.wasmQueryClient.fetchSmartContractState(
			address,
			Buffer.from(JSON.stringify(queryMsg)).toString("base64"),
		);
		const jsonResult = JSON.parse(fromUtf8(fromBase64(String(queryResult.data))));
		return jsonResult;
	}
	/**
	 *
	 */
	async queryMempool(): Promise<Mempool> {
		const mempoolResult = await this.httpClient.execute(createJsonRpcRequest("unconfirmed_txs"));
		return mempoolResult.result;
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
					injectiveAddress: this.publicAddress,
				};
				const simRes = await this.signAndBroadcastClient.simulate(broadcasterOptions);
				console.log("simulation succesful: \n", simRes);
				const res = await this.signAndBroadcastClient.broadcast(broadcasterOptions);
				return {
					height: res.height,
					code: res.code,
					transactionHash: res.txHash,
					rawLog: res.rawLog,
				};
			} else {
				const broadcasterOptions = {
					msgs: preppedMsgs,
					injectiveAddress: this.publicAddress,
					gasLimit: +fee.gas,
				};
				const res = await this.signAndBroadcastClient.broadcast(broadcasterOptions);
				return {
					height: res.height,
					code: res.code,
					transactionHash: res.txHash,
					rawLog: res.rawLog,
				};
			}
		} catch (e) {
			console.log("error in broadcasting:\n");
			console.log(e);

			return {
				height: 0,
				code: 1,
				transactionHash: "",
				rawLog: "",
			}; // console.log("simres: \n", simRes);
		}
	}

	/**
	 *
	 */
	async signAndBroadcastSkipBundle(messages: Array<EncodeObject>, fee: StdFee, memo?: string, otherTx?: TxRaw) {
		if (!this.skipBundleClient || !this.skipSigningAddress) {
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
			chainId: this.chainId,
			message: preppedMsgs.map((msg) => msg.toDirectSign()),
			pubKey: this.publicKey.toBase64(),
			sequence: this.sequence,
			accountNumber: this.accountNumber,
		});
		const signature = await this.privateKey.sign(Buffer.from(signBytes));

		txRaw.setSignaturesList([signature]);
		const cosmTxRaw = {
			signatures: txRaw.getSignaturesList_asU8(),
			bodyBytes: bodyBytes,
			authInfoBytes: authInfoBytes,
		};

		let signed;
		if (otherTx) {
			signed = await this.skipBundleClient.signBundle([otherTx, cosmTxRaw], this.signer, this.skipSigningAddress);
		} else {
			signed = await this.skipBundleClient.signBundle([cosmTxRaw], this.signer, this.skipSigningAddress);
		}
		console.log(inspect(signed, { depth: null }));
		const res = await this.skipBundleClient.sendBundle(signed, 0, true);
		return res;
	}
	/**
	 *
	 */
	private prepair(messages: Array<EncodeObject>) {
		try {
			const encodedExecuteMsgs: Array<MsgExecuteContract | MsgSend> = [];
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
						sender: this.publicAddress,

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
			});
			return encodedExecuteMsgs;
		} catch (error) {
			console.log(error);
		}
	}
}

export default InjectiveAdapter;
