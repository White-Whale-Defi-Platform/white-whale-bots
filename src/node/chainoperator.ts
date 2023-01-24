import { setupWasmExtension, SigningCosmWasmClient, WasmExtension } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice, QueryClient, setupAuthExtension } from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { HttpBatchClient, HttpClient } from "@cosmjs/tendermint-rpc/build/rpcclients";

import { BotConfig } from "../types/core/botConfig";

export type BotClients = {
	SigningCWClient: SigningCosmWasmClient; //used to sign transactions
	TMClient: Tendermint34Client; //used to broadcast transactions
	HttpClient: HttpBatchClient | HttpClient; //used to query rpc methods (unconfirmed_txs, account)
	WasmQueryClient: QueryClient & WasmExtension; //used to query wasm methods (contract states)
};

/**
 *
 * @param rpcUrl The RPC url endpoint to connect to.
 * @param mnemonic The BIP39 mnemonic for the wallet.
 * @param walletPrefix The prefix of the wallet address, e.g., `cosmos` or `terra`.
 * @param gasPrice The gas price to sign txs with.
 * @returns A connected RPC sender + querier, along with the account to sign with.
 */
export async function getChainOperator(botConfig: BotConfig) {
	// derive signing wallet
	const signer = await DirectSecp256k1HdWallet.fromMnemonic(botConfig.mnemonic, { prefix: botConfig.chainPrefix });
	// connect to client and querier
	const cwClient = await SigningCosmWasmClient.connectWithSigner(botConfig.rpcUrl, signer, {
		prefix: botConfig.chainPrefix,
		gasPrice: GasPrice.fromString(botConfig.gasPrice + botConfig.baseDenom),
	});
	const httpClient = new HttpBatchClient(botConfig.rpcUrl);
	const tmClient = await Tendermint34Client.create(httpClient);
	const queryClient = QueryClient.withExtensions(tmClient, setupWasmExtension, setupAuthExtension);

	const account = await signer.getAccounts();
	const botClients: BotClients = {
		SigningCWClient: cwClient,
		TMClient: tmClient,
		HttpClient: httpClient,
		WasmQueryClient: queryClient,
	};

	return [account[0], botClients] as const;
}
