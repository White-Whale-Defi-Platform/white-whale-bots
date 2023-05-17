import { toBase64, toUtf8 } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { OptimalTrade } from "../../../core/arbitrage/arbitrage";
import { Asset, isMatchingAssetInfos, isNativeAsset, toChainAsset, toChainPrice } from "../../../core/types/base/asset";
import { Path } from "../../../core/types/base/path";
import { AmmDexName, outGivenIn, Pool } from "../../../core/types/base/pool";
import { IncreaseAllowanceMessage } from "../../../core/types/messages/allowance";
import { FlashLoanMessage, WasmMessage } from "../../../core/types/messages/flashloanmessage";
import { SendMessage } from "../../../core/types/messages/sendmessages";
import { DefaultSwapMessage, InnerSwapMessage, JunoSwapMessage } from "../../../core/types/messages/swapmessages";
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
	const loanOfferAsset = { amount: String(Math.floor(+offerAsset0.amount)), info: offerAsset0.info };
	let offerAsset = { amount: String(Math.floor(+offerAsset0.amount)), info: offerAsset0.info };
	for (const pool of path.pools) {
		const [wasmMsgsPool, offerAssetNext] = getWasmMessages(pool, offerAsset);
		wasmMsgs.push(...wasmMsgsPool);
		offerAsset = offerAssetNext;
	}
	const flashLoanMessage: FlashLoanMessage = {
		flash_loan: {
			assets: [loanOfferAsset],
			msgs: wasmMsgs,
		},
	};
	return flashLoanMessage;
}
/**
 *
 */
function getWasmMessages(pool: Pool, _offerAsset: Asset) {
	const [outGivenInTrade, returnAssetInfo] = outGivenIn(pool, _offerAsset);
	const offerAssetChain = toChainAsset(_offerAsset); //will be compensated for 18 decimals if needed
	const beliefPriceChain = toChainPrice(_offerAsset, { amount: String(outGivenInTrade), info: returnAssetInfo }); //will be compensated for 18 decimals if needed
	let msg: DefaultSwapMessage | JunoSwapMessage | SendMessage;
	if (pool.dexname === AmmDexName.default || pool.dexname === AmmDexName.wyndex) {
		if (isNativeAsset(offerAssetChain.info)) {
			msg = <DefaultSwapMessage>{
				swap: {
					max_spread: "0.1",
					offer_asset: {
						amount: offerAssetChain.amount,
						info:
							pool.dexname === AmmDexName.default
								? offerAssetChain.info
								: { native: offerAssetChain.info.native_token.denom },
					},

					// belief_price: beliefPriceChain,
				},
			};
		} else {
			const innerSwapMsg: InnerSwapMessage = {
				swap: {
					belief_price: beliefPriceChain,
					max_spread: "0.1",
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
				min_output: String(Math.round(outGivenInTrade * 0.99)),
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
	return [wasmMessages, { amount: String(outGivenInTrade), info: returnAssetInfo }] as const;
}
