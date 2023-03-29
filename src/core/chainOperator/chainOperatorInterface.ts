import { JsonObject } from "@cosmjs/cosmwasm-stargate";
import { EncodeObject } from "@cosmjs/proto-signing";
import { StdFee } from "@cosmjs/stargate";

import { Mempool } from "../types/base/mempool";

export interface ChainOperatorInterface {
	publicAddress: string;

	signAndBroadcast: (msgs: Array<EncodeObject>, fee?: StdFee | "auto", memo?: string) => Promise<TxResponse>;
	// execute: (
	// 	senderAddress: string,
	// 	contractAddress: string,
	// 	msg: Record<string, unknown>,
	// 	funds?: ReadonlyArray<Coin>,
	// ) => Promise<ExecuteResult>;
	queryContractSmart: (address: string, queryMsg: Record<string, unknown>) => Promise<JsonObject>;
	// simulate: (
	// 	signerAddress: string,
	// 	messages: ReadonlyArray<EncodeObject>,
	// 	memo: string | undefined,
	// ) => Promise<number>;
	// getChainId: () => Promise<string>;
	// getNetwork: () => Promise<string>;
	// getBalance: (address: string, searchDenom: string) => Promise<Coin>;
	queryMempool: () => Promise<Mempool>;
}

export interface TxResponse {
	readonly height: number;
	/** Error code. The transaction succeeded if code is 0. */
	readonly code: number;
	readonly transactionHash: string;
	readonly rawLog?: string;
}
