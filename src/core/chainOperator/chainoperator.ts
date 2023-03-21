import { JsonObject } from "@cosmjs/cosmwasm-stargate";
import { EncodeObject } from "@cosmjs/proto-signing";
import { Network } from "@injectivelabs/networks";

import { BotConfig } from "../types/base/botConfig";
import CosmjsAdapter from "./chainAdapters/cosmjs";
import InjectiveAdapter from "./chainAdapters/injective";
<<<<<<< HEAD
import { ChainOperatorInterface, TxResponse } from "./chainOperatorInterface";
/**
 *
 */
export class ChainOperator implements ChainOperatorInterface {
=======
import { TxResponse } from "./chainOperatorInterface";
/**
 *
 */
export class ChainOperator {
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
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
	async signAndBroadcast(
		senderAddress: string,
		msgs: Array<EncodeObject>,
		memo?: string | undefined,
	): Promise<TxResponse> {
<<<<<<< HEAD
		return await this.client.signAndBroadcast(senderAddress, msgs, memo);
=======
		return await this.client.signAndBroadcast(senderAddress, msgs, "auto", memo);
>>>>>>> 44f02fa (feat: injectiveclient abstraction)
	}
}

// /**
//  *
//  * @param rpcUrl The RPC url endpoint to connect to.
//  * @param mnemonic The BIP39 mnemonic for the wallet.
//  * @param walletPrefix The prefix of the wallet address, e.g., `cosmos` or `terra`.
//  * @param gasPrice The gas price to sign txs with.
//  * @returns A connected RPC sender + querier, along with the account to sign with.
//  */
// export async function getChainOperator(botConfig: BotConfig): Promise<ChainOperator> {
// 	if (botConfig.chainPrefix === "inj") {
// 		//get injective clients
// 		const clients = getInjectiveClient(botConfig);

// 		return { clients: clients, clientsType: ClientsType.Injective };
// 	} else {
// 		const clients = await getCosmJSClient(botConfig);
// 		return { clients: clients, clientsType: ClientsType.CosmJS };
// 	}
// }
/**
 *
 */
// async function getCosmJSClient(botConfig: BotConfig): Promise<CosmjsClients> {
// 	// derive signing wallet
// 	const signer = await DirectSecp256k1HdWallet.fromMnemonic(botConfig.mnemonic, {
// 		prefix: botConfig.chainPrefix,
// 	});
// 	// connect to client and querier
// 	const cwClient = await SigningCosmWasmClient.connectWithSigner(botConfig.rpcUrl, signer, {
// 		prefix: botConfig.chainPrefix,
// 		gasPrice: GasPrice.fromString(botConfig.gasPrice + botConfig.baseDenom),
// 	});
// 	const httpClient = new HttpBatchClient(botConfig.rpcUrl);
// 	const tmClient = await Tendermint34Client.create(httpClient);
// 	const queryClient = QueryClient.withExtensions(tmClient, setupWasmExtension, setupAuthExtension);
// 	const account = await signer.getAccounts();
// 	return {
// 		SigningCWClient: cwClient,
// 		TMClient: tmClient,
// 		HttpClient: httpClient,
// 		WasmQueryClient: queryClient,
// 		Account: account[0],
// 	};
// }
// /**
//  *
//  */
// function getInjectiveClient(botConfig: BotConfig): InjectiveClients {
// 	const network = Network.Mainnet;
// 	const endpoints = getNetworkEndpoints(network);
// 	const privateKey = PrivateKey.fromMnemonic(botConfig.mnemonic);

// 	const broadcasterOptions = {
// 		network: network,
// 		privateKey: privateKey,
// 	};
// 	const SpotQueryClient = new IndexerGrpcSpotApi(endpoints.indexer);
// 	const SignAndBroadcastClient = new MsgBroadcasterWithPk(broadcasterOptions);
// 	const WasmQueryClient = new ChainGrpcWasmApi(endpoints.grpc);
// 	const broadcast = injBroadcast;

// 	return { SignAndBroadcastClient, SpotQueryClient, WasmQueryClient, broadcast };
// }
