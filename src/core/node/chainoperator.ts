import { setupWasmExtension, SigningCosmWasmClient, WasmExtension } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { AccountData } from "@cosmjs/proto-signing/build/signer";
import { GasPrice, QueryClient, setupAuthExtension } from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { HttpBatchClient, HttpClient } from "@cosmjs/tendermint-rpc/build/rpcclients";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import { ChainGrpcWasmApi, IndexerGrpcSpotApi, MsgBroadcasterWithPk, PrivateKey } from "@injectivelabs/sdk-ts";
import { MsgExecuteContract } from "@injectivelabs/sdk-ts";
import { TxResponse } from "@injectivelabs/sdk-ts";

import { BotConfig } from "../types/base/botConfig";
import { injBroadcast } from "./broadcaster/injective";

export enum ClientsType {
	CosmJS = "cosmjs",
	Injective = "injective",
}
export type ChainOperator = {
	clients: InjectiveClients | CosmjsClients;
	clientsType: ClientsType;
};
export type InjectiveClients = {
	SignAndBroadcastClient: MsgBroadcasterWithPk;
	SpotQueryClient: IndexerGrpcSpotApi;
	WasmQueryClient: ChainGrpcWasmApi;
	broadcast: (broadcaster: MsgBroadcasterWithPk, msg: MsgExecuteContract) => Promise<TxResponse>;
};
export type CosmjsClients = {
	SigningCWClient: SigningCosmWasmClient; //used to sign transactions
	TMClient: Tendermint34Client; //used to broadcast transactions
	HttpClient: HttpBatchClient | HttpClient; //used to query rpc methods (unconfirmed_txs, account)
	WasmQueryClient: QueryClient & WasmExtension; //used to query wasm methods (contract states)
	Account: AccountData;
};

/**
 *
 * @param rpcUrl The RPC url endpoint to connect to.
 * @param mnemonic The BIP39 mnemonic for the wallet.
 * @param walletPrefix The prefix of the wallet address, e.g., `cosmos` or `terra`.
 * @param gasPrice The gas price to sign txs with.
 * @returns A connected RPC sender + querier, along with the account to sign with.
 */
export async function getChainOperator(botConfig: BotConfig): Promise<ChainOperator> {
	if (botConfig.chainPrefix === "inj") {
		//get injective clients
		const clients = getInjectiveClient(botConfig);

		return { clients: clients, clientsType: ClientsType.Injective };
	} else {
		const clients = await getCosmJSClient(botConfig);
		return { clients: clients, clientsType: ClientsType.CosmJS };
	}
}
/**
 *
 */
async function getCosmJSClient(botConfig: BotConfig): Promise<CosmjsClients> {
	// derive signing wallet
	const signer = await DirectSecp256k1HdWallet.fromMnemonic(botConfig.mnemonic, {
		prefix: botConfig.chainPrefix,
	});
	// connect to client and querier
	const cwClient = await SigningCosmWasmClient.connectWithSigner(botConfig.rpcUrl, signer, {
		prefix: botConfig.chainPrefix,
		gasPrice: GasPrice.fromString(botConfig.gasPrice + botConfig.baseDenom),
	});
	const httpClient = new HttpBatchClient(botConfig.rpcUrl);
	const tmClient = await Tendermint34Client.create(httpClient);
	const queryClient = QueryClient.withExtensions(tmClient, setupWasmExtension, setupAuthExtension);
	const account = await signer.getAccounts();
	return {
		SigningCWClient: cwClient,
		TMClient: tmClient,
		HttpClient: httpClient,
		WasmQueryClient: queryClient,
		Account: account[0],
	};
}
/**
 *
 */
function getInjectiveClient(botConfig: BotConfig): InjectiveClients {
	const network = Network.Mainnet;
	const endpoints = getNetworkEndpoints(network);
	const privateKey = PrivateKey.fromMnemonic(botConfig.mnemonic);

	const broadcasterOptions = {
		network: network,
		privateKey: privateKey,
	};
	const SpotQueryClient = new IndexerGrpcSpotApi(endpoints.indexer);
	const SignAndBroadcastClient = new MsgBroadcasterWithPk(broadcasterOptions);
	const WasmQueryClient = new ChainGrpcWasmApi(endpoints.grpc);
	const broadcast = injBroadcast;

	return { SignAndBroadcastClient, SpotQueryClient, WasmQueryClient, broadcast };
}
