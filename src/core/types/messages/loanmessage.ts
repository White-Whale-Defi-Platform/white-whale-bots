export interface BorrowStableMessage {
	borrow_stable: {
		borrow_amount: string;
		to: string;
	};
}
export interface RepayStableMessage {
	repay_stable: object;
}
/**
 * Checks if a provided `msg` is of type `BorrowStableMessage`.
 */
export function isBorrowStableMessage(msg: any): msg is BorrowStableMessage {
	return msg["borrow_stable" as keyof typeof msg] !== undefined;
}

/**
 * Checks if a provided `msg` is of type `RepayStableMessage`.
 */
export function isRepayStableMessage(msg: any): msg is RepayStableMessage {
	return msg["repay_stable" as keyof typeof msg] !== undefined;
}
