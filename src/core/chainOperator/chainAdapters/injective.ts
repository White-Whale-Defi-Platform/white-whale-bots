import { JsonObject } from "@cosmjs/cosmwasm-stargate";
import { fromBase64, fromUtf8 } from "@cosmjs/encoding";
import { DirectSecp256k1HdWallet, EncodeObject, OfflineDirectSigner } from "@cosmjs/proto-signing";
<<<<<<< HEAD
=======
import { StdFee } from "@cosmjs/stargate";
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import {
	BaseAccount,
	ChainGrpcWasmApi,
	ChainRestAuthApi,
	getDefaultSubaccountId,
	IndexerGrpcSpotApi,
	MsgBroadcasterWithPk,
	MsgExecuteContract,
	PrivateKey,
	PublicKey,
} from "@injectivelabs/sdk-ts";
<<<<<<< HEAD
import { ChainId } from "@injectivelabs/ts-types";

import { BotConfig } from "../../types/base/botConfig";
import { ChainOperatorInterface, TxResponse } from "../chainOperatorInterface";
=======
import { AccountDetails } from "@injectivelabs/sdk-ts/dist/types/auth";
import { ChainId } from "@injectivelabs/ts-types";

import { BotConfig } from "../../types/base/botConfig";
import { TxResponse } from "../chainOperatorInterface";
>>>>>>> 44f02fa (feat: injectiveclient abstraction)

/**
 *
 */
<<<<<<< HEAD
class InjectiveAdapter implements ChainOperatorInterface {
=======
class InjectiveAdapter {
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
	signAndBroadcastClient: MsgBroadcasterWithPk;
	spotQueryClient: IndexerGrpcSpotApi;
	wasmQueryClient: ChainGrpcWasmApi;
	chainId: ChainId;
	network: Network;
	publicKey: PublicKey;
	publicAddress: string;
	ethereumAddress: string;
	subAccountId: string;
<<<<<<< HEAD
	signer!: OfflineDirectSigner;
	accountNumber = 0;
	sequence = 0;
=======
	baseAccount!: BaseAccount;
	accountDetails!: AccountDetails;
	signer!: OfflineDirectSigner;
>>>>>>> 44f02fa (feat: injectiveclient abstraction)

	/**
	 *
	 */
	constructor(botConfig: BotConfig, network: Network = Network.MainnetK8s) {
		const endpoints = getNetworkEndpoints(network);
		const privateKey = PrivateKey.fromMnemonic(botConfig.mnemonic);
		this.signAndBroadcastClient = new MsgBroadcasterWithPk({
			network: network,
			privateKey: privateKey,
		});
		this.spotQueryClient = new IndexerGrpcSpotApi(endpoints.indexer);
		this.wasmQueryClient = new ChainGrpcWasmApi(endpoints.grpc);
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
<<<<<<< HEAD
		const baseAccount = BaseAccount.fromRestApi(accountDetailsResponse);
		const accountDetails = baseAccount.toAccountDetails();
		this.accountNumber = accountDetails.accountNumber;
		this.sequence = accountDetails.sequence;
=======
		this.baseAccount = BaseAccount.fromRestApi(accountDetailsResponse);
		this.accountDetails = this.baseAccount.toAccountDetails();
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
		const signer = await DirectSecp256k1HdWallet.fromMnemonic(botConfig.mnemonic, {
			prefix: botConfig.chainPrefix,
		});
		this.signer = signer;
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
<<<<<<< HEAD
	async signAndBroadcast(signerAddress: string, messages: Array<EncodeObject>, memo?: string): Promise<TxResponse> {
=======
	async signAndBroadcast(
		signerAddress: string,
		messages: Array<EncodeObject>,
		fee: StdFee | "auto" | number,
		memo?: string,
	): Promise<TxResponse> {
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
		const preppedMsgs = this.prepair(messages);
		if (!preppedMsgs) {
			console.log("cannot create txRaw from encodeMessage");
			process.exit(1);
		}
		const broadcasterOptions = {
			msgs: preppedMsgs,
			injectiveAddress: this.publicAddress,
			ethereumAddress: this.ethereumAddress,
			gasLimit: 1400000,
		};
		try {
			const simRes = await this.signAndBroadcastClient.simulate(broadcasterOptions);
			const res = await this.signAndBroadcastClient.broadcast(broadcasterOptions);
			console.log("simulation succesful: \n", simRes);
			return {
				height: res.height,
				code: res.code,
				transactionHash: res.txHash,
				rawLog: res.rawLog,
			};
		} catch (e) {
			console.log("error in simulation:\n");
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
	private prepair(messages: Array<EncodeObject>, send = true) {
		try {
			const encodedExecuteMsg = messages.map((msg, idx) => {
				const { msgT, contract, funds } = msg?.value || {};
				const msgString = Buffer.from(msg?.value?.msg).toString("utf8");
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
<<<<<<< HEAD
					sender: this.publicAddress,
=======
					sender: this.accountDetails.address,
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
					contractAddress: contract,
					exec: executeMessageJson,
				};

				const MessageExecuteContract = MsgExecuteContract.fromJSON(params);
				return MessageExecuteContract;
			});
			return encodedExecuteMsg;
		} catch (error) {
			console.log(error);
		}
	}
}

export default InjectiveAdapter;
