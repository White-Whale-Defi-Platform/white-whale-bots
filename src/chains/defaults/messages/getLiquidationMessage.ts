import { toUtf8 } from "@cosmjs/encoding";
import { EncodeObject } from "@cosmjs/proto-signing";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { LiquidationMessage } from "../../../core/types/messages/liquidationmessages";

/**
 *
 */
export function getliqudationMessage(sender: string, overseerAddress: string, borrowerAddress: string) {
	const message: LiquidationMessage = {
		liquidate_collateral: {
			borrower: borrowerAddress,
		},
	};
	const encodedMsgObject: EncodeObject = {
		typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
		value: MsgExecuteContract.fromPartial({
			sender: sender,
			contract: overseerAddress,
			msg: toUtf8(JSON.stringify(message)),
			funds: [],
		}),
	};
	return encodedMsgObject;
}
