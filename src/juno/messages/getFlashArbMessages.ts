import { toBase64, toUtf8 } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { Asset, isMatchingAssetInfos, isNativeAsset } from "../../types/core/asset";
import { Path } from "../../types/core/path";
import { AmmDexName, outGivenIn, Pool } from "../../types/core/pool";
import { IncreaseAllowanceMessage } from "../../types/messages/allowance";
import { FlashLoanMessage, WasmMessage } from "../../types/messages/flashloanmessage";
import { SendMessage } from "../../types/messages/sendmessages";
import { InnerSwapMessage, JunoSwapMessage, SwapMessage } from "../../types/messages/swapmessages";
/**
 *
 */
export function getFlashArbMessages(
	path: Path,
	walletAddress: string,
	offerAsset0: Asset,
): [Array<EncodeObject>, number] {
	let flashLoanMessage: FlashLoanMessage;
	if (path.pools.length === 3) {
		flashLoanMessage = getFlashArbMessages3Hop(path, offerAsset0);
	} else {
		flashLoanMessage = getFlashArbMessages2Hop(path, offerAsset0);
	}
	const encodedMsgObject: EncodeObject = {
		typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
		value: MsgExecuteContract.fromPartial({
			sender: walletAddress,
			contract: "juno1qa7vdlm6zgq3radal5sltyl4t4qd32feug9qs50kcxda46q230pqzny48s",
			msg: toUtf8(JSON.stringify(flashLoanMessage)),
			funds: [],
		}),
	};
	return [[encodedMsgObject], flashLoanMessage.flash_loan.msgs.length];
}

/**
 *
 */
function getFlashArbMessages2Hop(path: Path, offerAsset0: Asset): FlashLoanMessage {
	// double swap message as we trade only native assets
	const [wasmMsgs0, offerAsset1] = getWasmMessages(path.pools[0], offerAsset0);
	const [wasmMsgs1, offerAsset2] = getWasmMessages(path.pools[1], offerAsset1);

	const flashLoanMessage: FlashLoanMessage = {
		flash_loan: {
			assets: [offerAsset0],
			msgs: [...wasmMsgs0, ...wasmMsgs1],
		},
	};
	return flashLoanMessage;
}
/**
 *
 */
function getFlashArbMessages3Hop(path: Path, offerAsset0: Asset): FlashLoanMessage {
	// double swap message as we trade only native assets
	const [wasmMsgs0, offerAsset1] = getWasmMessages(path.pools[0], offerAsset0);
	const [wasmMsgs1, offerAsset2] = getWasmMessages(path.pools[1], offerAsset1);
	const [wasmMsgs2, offerAsset3] = getWasmMessages(path.pools[2], offerAsset2);
	const flashLoanMessage: FlashLoanMessage = {
		flash_loan: {
			assets: [offerAsset0],
			msgs: [...wasmMsgs0, ...wasmMsgs1, ...wasmMsgs2],
		},
	};
	return flashLoanMessage;
}

/**
 *
 */
function getWasmMessages(pool: Pool, offerAsset: Asset) {
	const [outGivenInTrade, returnAssetInfo] = outGivenIn(pool, offerAsset);
	console.log(
		pool.address,
		": ",
		"in: ",
		offerAsset.amount,
		isNativeAsset(offerAsset.info) ? offerAsset.info.native_token.denom : offerAsset.info.token.contract_addr,
		"out: ",
		outGivenInTrade,
		isNativeAsset(returnAssetInfo) ? returnAssetInfo.native_token.denom : returnAssetInfo.token.contract_addr,
	);
	const beliefPrice = Math.round((+offerAsset.amount / outGivenInTrade) * 1e6) / 1e6; //gives price per token bought
	const nextOfferAsset: Asset = { amount: String(outGivenInTrade), info: returnAssetInfo };
	let msg: SwapMessage | JunoSwapMessage | SendMessage;
	if (pool.dexname === AmmDexName.default || pool.dexname === AmmDexName.wyndex) {
		if (isNativeAsset(offerAsset.info)) {
			msg = <SwapMessage>{
				swap: {
					max_spread: "0.05",
					offer_asset:
						pool.dexname === AmmDexName.default
							? offerAsset
							: { amount: offerAsset.amount, info: { native: offerAsset.info.native_token.denom } },
					belief_price: String(beliefPrice),
				},
			};
		} else {
			const innerSwapMsg: InnerSwapMessage = {
				swap: { belief_price: String(beliefPrice), max_spread: "0.0005" },
			};
			const objJsonStr = JSON.stringify(innerSwapMsg);
			const objJsonB64 = Buffer.from(objJsonStr).toString("base64");
			msg = <SendMessage>{
				send: {
					amount: offerAsset.amount,
					contract: pool.address,
					msg: objJsonB64,
				},
			};
		}
	} else {
		msg = <JunoSwapMessage>{
			swap: {
				input_token: isMatchingAssetInfos(pool.assets[0].info, offerAsset.info) ? "Token1" : "Token2",
				input_amount: offerAsset.amount,
				min_output: String(Math.round(outGivenInTrade * 0.95)),
			},
		};
	}
	const wasmMessage: WasmMessage = {
		wasm: {
			execute: {
				contract_addr:
					!isNativeAsset(offerAsset.info) &&
					(pool.dexname === AmmDexName.default || pool.dexname === AmmDexName.wyndex)
						? offerAsset.info.token.contract_addr
						: pool.address,
				funds: isNativeAsset(offerAsset.info)
					? [
							{
								amount: offerAsset.amount,
								denom: offerAsset.info.native_token.denom,
							},
					  ]
					: [],
				msg: toBase64(toUtf8(JSON.stringify(msg))),
			},
		},
	};
	const wasmMessages: Array<WasmMessage> = [];
	if (!isNativeAsset(offerAsset.info) && pool.dexname === AmmDexName.junoswap) {
		const allowanceMessage: IncreaseAllowanceMessage = {
			increase_allowance: {
				amount: offerAsset.amount,
				spender: pool.address,
			},
		};

		const allowanceWasmMessage: WasmMessage = {
			wasm: {
				execute: {
					contract_addr: offerAsset.info.token.contract_addr,
					funds: [],
					msg: toBase64(toUtf8(JSON.stringify(allowanceMessage))),
				},
			},
		};
		wasmMessages.push(allowanceWasmMessage);
	}
	wasmMessages.push(wasmMessage);
	return [wasmMessages, nextOfferAsset] as const;
}
