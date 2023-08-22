import { EncodeObject } from "@cosmjs/proto-signing";

import { OptimalTrade } from "../../../core/arbitrage/arbitrage";
import { OptimalOrderbookTrade } from "../../../core/arbitrage/optimizers/orderbookOptimizer";
import { getOrderbookArbMessages } from "../../inj/messages/getOrderbookArbMessage";
import { getFlashArbMessages } from "./getFlashArbMessages";
/**
 *
 */
export function messageFactory(
	arbTrade: OptimalTrade | OptimalOrderbookTrade,
	publicAddress: string,
	flashloancontract?: string,
): [Array<EncodeObject>, number] | undefined {
	if (arbTrade.path["orderbook" as keyof typeof arbTrade.path] !== undefined) {
		return getOrderbookArbMessages(<OptimalOrderbookTrade>arbTrade, publicAddress);
	} else if (flashloancontract !== undefined) {
		return getFlashArbMessages(<OptimalTrade>arbTrade, publicAddress, flashloancontract);
	} else {
		return undefined;
	}
}
