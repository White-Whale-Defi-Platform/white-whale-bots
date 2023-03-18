import { JsonObject } from "@cosmjs/cosmwasm-stargate";
import { EncodeObject } from "@cosmjs/proto-signing";

export interface ChainOperatorInterface {
	publicAddress: string;
	signAndBroadcast: (senderAddress: string, msgs: Array<EncodeObject>, memo?: string) => Promise<TxResponse>;
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
}

export interface TxResponse {
	readonly height: number;
	/** Error code. The transaction succeeded if code is 0. */
	readonly code: number;
	readonly transactionHash: string;
	readonly rawLog?: string;
}
