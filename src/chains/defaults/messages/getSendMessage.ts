import { EncodeObject } from "@cosmjs/proto-signing";
import { MsgSendEncodeObject } from "@cosmjs/stargate/build/modules/bank/messages";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
/**
 *
 */
export function getSendMessage(amount: string, denom: string, fromAddress: string, toAddress: string): EncodeObject {
	let trueAmount = amount;
	if (denom === "inj") {
		trueAmount = String(+amount * 10e12);
	}
	const sendAmount = [{ amount: trueAmount, denom: denom }];

	const msgSend = MsgSend.fromJSON({
		fromAddress: fromAddress,
		toAddress: toAddress,
		amount: sendAmount,
	});
	const msgSendEncoded: MsgSendEncodeObject = {
		typeUrl: "/cosmos.bank.v1beta1.MsgSend",
		value: msgSend,
	};
	return msgSendEncoded;
}
