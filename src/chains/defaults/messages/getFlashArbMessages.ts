import { toBase64, toUtf8 } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { OptimalTrade } from "../../../core/arbitrage/arbitrage";
import { Asset, isMatchingAssetInfos, isNativeAsset } from "../../../core/types/base/asset";
import { Path } from "../../../core/types/base/path";
import { AmmDexName, outGivenIn, Pool } from "../../../core/types/base/pool";
import { IncreaseAllowanceMessage } from "../../../core/types/messages/allowance";
import { FlashLoanMessage, WasmMessage } from "../../../core/types/messages/flashloanmessage";
import { SendMessage } from "../../../core/types/messages/sendmessages";
import { InnerSwapMessage, JunoSwapMessage, SwapMessage } from "../../../core/types/messages/swapmessages";
/**
 *
 */
export function getFlashArbMessages(
	arbTrade: OptimalTrade,
	walletAddress: string,
	flashloancontract: string,
): [Array<EncodeObject>, number] {
	const flashloanMessage = getFlashArbMessage(arbTrade.path, arbTrade.offerAsset);

	const encodedMsgObject: EncodeObject = {
		typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
		value: MsgExecuteContract.fromPartial({
			sender: walletAddress,
			contract: flashloancontract,
			msg: toUtf8(JSON.stringify(flashloanMessage)),
			funds: [],
		}),
	};
	return [[encodedMsgObject], flashloanMessage.flash_loan.msgs.length];
}

/**
 *
 */
function getFlashArbMessage(path: Path, offerAsset0: Asset): FlashLoanMessage {
	const wasmMsgs = [];
	let offerAsset = offerAsset0;
	for (const pool of path.pools) {
		const [wasmMsgsPool, offerAssetNext] = getWasmMessages(pool, offerAsset);
		wasmMsgs.push(...wasmMsgsPool);
		offerAsset = offerAssetNext;
	}
	const flashLoanMessage: FlashLoanMessage = {
		flash_loan: {
			assets: [offerAsset0],
			msgs: wasmMsgs,
		},
	};
	return flashLoanMessage;
}
/**
 *
 */
function getWasmMessages(pool: Pool, offerAsset: Asset) {
	const [outGivenInTrade, returnAssetInfo] = outGivenIn(pool, offerAsset);
	const beliefPrice = Math.round((+offerAsset.amount / outGivenInTrade) * 1e6) / 1e6; //gives price per token bought
	const nextOfferAsset: Asset = { amount: String(outGivenInTrade), info: returnAssetInfo };
	let msg: SwapMessage | JunoSwapMessage | SendMessage;
	if (pool.dexname === AmmDexName.default || pool.dexname === AmmDexName.wyndex) {
		if (isNativeAsset(offerAsset.info)) {
			msg = <SwapMessage>{
				swap: {
					max_spread: "0.01",
					offer_asset:
						pool.dexname === AmmDexName.default
							? offerAsset
							: { amount: offerAsset.amount, info: { native: offerAsset.info.native_token.denom } },
					belief_price: String(beliefPrice),
				},
			};
		} else {
			const innerSwapMsg: InnerSwapMessage = {
				swap: { belief_price: String(beliefPrice), max_spread: "0.01" },
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
