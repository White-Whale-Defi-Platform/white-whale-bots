import { toBase64, toUtf8 } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";
import { OrderTypeMap } from "@injectivelabs/sdk-ts";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { inspect } from "util";

import {
	isMatchingAssetInfos,
	isNativeAsset,
	RichAsset,
	toChainAsset,
	toChainPrice,
} from "../../../core/types/base/asset";
import { OrderSequence } from "../../../core/types/base/path";
import { AmmDexName, caclulateSpread, outGivenIn, Pool } from "../../../core/types/base/pool";
import { OptimalOrderbookTrade } from "../../../core/types/base/trades";
import { IncreaseAllowanceMessage } from "../../../core/types/messages/allowance";
import { FlashLoanMessage, WasmMessage } from "../../../core/types/messages/flashloanmessage";
import { SendMessage } from "../../../core/types/messages/sendmessages";
import { DefaultSwapMessage, InnerSwapMessage, JunoSwapMessage } from "../../../core/types/messages/swapmessages";
import { getMarketSpotOrderMessage } from "./getSpotOrderMessage";
/**
 *
 */
export function getOrderbookFlashArbMessages(
	arbTrade: OptimalOrderbookTrade,
	publicAddress: string,
	flashloancontract: string,
): [Array<EncodeObject>, number] {
	const flashloanMessage = getOrderbookFlashArbMessage(arbTrade, flashloancontract);
	const encodedMsgObject: EncodeObject = {
		typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
		value: MsgExecuteContract.fromPartial({
			sender: publicAddress,
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
function getOrderbookFlashArbMessage(arbTrade: OptimalOrderbookTrade, publicAddress: string): FlashLoanMessage {
	const offerAsset0 = arbTrade.offerAsset;
	const path = arbTrade.path;
	const operationMsgs = [];
	const loanOfferAsset = { amount: String(Math.floor(+offerAsset0.amount)), info: offerAsset0.info };

	let offerAsset: RichAsset = {
		amount: String(Math.floor(+offerAsset0.amount)),
		info: offerAsset0.info,
		decimals: offerAsset0.decimals,
	};

	if (path.orderSequence === OrderSequence.AmmFirst) {
		const [ammWasmMessage, offerAssetNext] = getWasmMessages(path.pool, offerAsset);
		offerAsset = offerAssetNext;

		offerAsset.amount = String(
			Math.floor(+offerAssetNext.amount / path.orderbook.minQuantityIncrement) *
				path.orderbook.minQuantityIncrement,
		);

		const msg1 = getMarketSpotOrderMessage(arbTrade, publicAddress, offerAsset, OrderTypeMap.SELL_ATOMIC);
		console.log(inspect(msg1, true, null, true));
		const nestedMsg1 = {
			stargate: {
				type_url: msg1.typeUrl,
				value: Buffer.from(msg1.value.toBinary()).toString("base64"),
			},
		};
		operationMsgs.push(...ammWasmMessage, nestedMsg1);
	} else {
		const offerAsset1 = {
			amount: String(
				Math.floor(arbTrade.outGivenInOrderbook / arbTrade.path.orderbook.minQuantityIncrement) *
					arbTrade.path.orderbook.minQuantityIncrement,
			),
			info: arbTrade.path.orderbook.baseAssetInfo,
			decimals: arbTrade.path.orderbook.baseAssetDecimals,
		};
		const msg0 = getMarketSpotOrderMessage(arbTrade, publicAddress, offerAsset1, OrderTypeMap.BUY_ATOMIC);
		console.log(inspect(msg0, true, null, true));
		const nestedMsg0 = {
			stargate: {
				type_url: msg0.typeUrl,
				value: Buffer.from(msg0.value.toBinary()).toString("base64"),
			},
		};
		const [ammWasmMessage, offerAssetNext] = getWasmMessages(path.pool, offerAsset1);
		operationMsgs.push(nestedMsg0, ...ammWasmMessage);
	}

	const flashLoanMessage: FlashLoanMessage = {
		flash_loan: {
			assets: [loanOfferAsset],
			msgs: operationMsgs,
		},
	};
	return flashLoanMessage;
}
/**
 *
 */
function getWasmMessages(pool: Pool, _offerAsset: RichAsset) {
	const outAsset = outGivenIn(pool, _offerAsset);
	const beliefPriceChain = toChainPrice(_offerAsset, outAsset); //will be compensated for 18 decimals if needed
	const spread = caclulateSpread(pool, _offerAsset, beliefPriceChain);
	const offerAssetChain = toChainAsset(_offerAsset); //will be compensated for 18 decimals if needed

	let msg: DefaultSwapMessage | JunoSwapMessage | SendMessage;
	if (pool.dexname === AmmDexName.default || pool.dexname === AmmDexName.wyndex) {
		if (isNativeAsset(offerAssetChain.info)) {
			msg = <DefaultSwapMessage>{
				swap: {
					max_spread: String(spread),
					offer_asset: {
						amount: offerAssetChain.amount,
						info:
							pool.dexname === AmmDexName.default
								? offerAssetChain.info
								: { native: offerAssetChain.info.native_token.denom },
					},

					belief_price: beliefPriceChain,
				},
			};
		} else {
			const innerSwapMsg: InnerSwapMessage = {
				swap: {
					belief_price: beliefPriceChain,
					max_spread: String(spread),
				},
			};
			const objJsonStr = JSON.stringify(innerSwapMsg);
			const objJsonB64 = Buffer.from(objJsonStr).toString("base64");
			msg = <SendMessage>{
				send: {
					amount: offerAssetChain.amount,
					contract: pool.address,
					msg: objJsonB64,
				},
			};
		}
	} else {
		msg = <JunoSwapMessage>{
			swap: {
				input_token: isMatchingAssetInfos(pool.assets[0].info, offerAssetChain.info) ? "Token1" : "Token2",
				input_amount: offerAssetChain.amount,
				min_output: String(Math.round(+outAsset.amount * 0.99)),
			},
		};
	}
	const wasmMessage: WasmMessage = {
		wasm: {
			execute: {
				contract_addr:
					!isNativeAsset(offerAssetChain.info) &&
					(pool.dexname === AmmDexName.default || pool.dexname === AmmDexName.wyndex)
						? offerAssetChain.info.token.contract_addr
						: pool.address,
				funds: isNativeAsset(offerAssetChain.info)
					? [
							{
								amount: offerAssetChain.amount,
								denom: offerAssetChain.info.native_token.denom,
							},
					  ]
					: [],
				msg: toBase64(toUtf8(JSON.stringify(msg))),
			},
		},
	};
	const wasmMessages: Array<WasmMessage> = [];
	if (!isNativeAsset(offerAssetChain.info) && pool.dexname === AmmDexName.junoswap) {
		const allowanceMessage: IncreaseAllowanceMessage = {
			increase_allowance: {
				amount: offerAssetChain.amount,
				spender: pool.address,
			},
		};

		const allowanceWasmMessage: WasmMessage = {
			wasm: {
				execute: {
					contract_addr: offerAssetChain.info.token.contract_addr,
					funds: [],
					msg: toBase64(toUtf8(JSON.stringify(allowanceMessage))),
				},
			},
		};
		wasmMessages.push(allowanceWasmMessage);
	}
	wasmMessages.push(wasmMessage);
	return [wasmMessages, outAsset] as const;
}
