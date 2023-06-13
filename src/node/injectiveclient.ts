import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import {
	ChainGrpcBankApi,
	ChainGrpcExchangeApi,
	ChainGrpcWasmApi,
	IndexerGrpcAccountApi,
	IndexerGrpcSpotApi,
	MsgBroadcasterWithPk,
	PrivateKey,
} from "@injectivelabs/sdk-ts";
import { inspect } from "util";

/**
 *
 */
export function getInjectiveClient(mnemonic: string) {
	const network = Network.Mainnet;
	const endpoints = getNetworkEndpoints(network);
	console.log(inspect(endpoints, { depth: null }));
	const privateKey = PrivateKey.fromMnemonic(mnemonic);

	const broadcasterOptions = {
		network: network,
		privateKey: privateKey,
	};
	const spotMarketClient = new ChainGrpcExchangeApi(endpoints.grpc);
	const spotClient = new IndexerGrpcSpotApi(endpoints.indexer);
	const broadcastClient = new MsgBroadcasterWithPk(broadcasterOptions);
	const wasmClient = new ChainGrpcWasmApi(endpoints.grpc);
	const bankclient = new ChainGrpcBankApi(endpoints.grpc);

	const accountClient = new IndexerGrpcAccountApi(endpoints.indexer);

	return { broadcastClient, spotClient, wasmClient, accountClient, bankclient };
}
