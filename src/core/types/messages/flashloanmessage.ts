import { Asset } from "../base/asset";

export type ExecuteMessage = {
	execute: {
		contract_addr: string;
		funds: Array<{ amount: string; denom: string }> | [];
		msg: string;
	};
};
export type WasmMessage = {
	wasm: ExecuteMessage;
};

export type FlashLoanMessage = {
	flash_loan: {
		assets: Array<Asset>;
		msgs: Array<WasmMessage>;
	};
};
