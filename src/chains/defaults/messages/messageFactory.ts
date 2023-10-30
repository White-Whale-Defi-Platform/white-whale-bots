import { EncodeObject } from "@cosmjs/proto-signing";

import { OptimalOrderbookTrade, OptimalTrade, Trade, TradeType } from "../../../core/types/base/trades";
import { getOrderbookArbMessages } from "../../inj/messages/getOrderbookArbMessage";
import { getOrderbookFlashArbMessages } from "../../inj/messages/getOrderbookFlashArbMessages";
import { getFlashArbMessages } from "./getFlashArbMessages";
/**
 *
 */
export function messageFactory(
	arbTrade: Trade,
	publicAddress: string,
	flashloancontract?: string,
): [Array<EncodeObject>, number] | undefined {
	switch (arbTrade.tradeType) {
		case TradeType.COMBINED:
			if (flashloancontract) {
				return getOrderbookFlashArbMessages(<OptimalOrderbookTrade>arbTrade, publicAddress, flashloancontract);
			} else {
				return getOrderbookArbMessages(<OptimalOrderbookTrade>arbTrade, publicAddress);
			}
		case TradeType.AMM:
			if (flashloancontract) {
				return getFlashArbMessages(<OptimalTrade>arbTrade, publicAddress, flashloancontract);
			} else {
				//return arb messages without flashloan
				return undefined;
			}
	}
}
