export interface LockCollateralMessage {
	lock_collateral: {
		collaterals: [[string, string]];
	};
}

export interface UnlockCollateralMessage {
	unlock_collateral: {
		collaterals: [[string, string]];
	};
}

export interface BorrowStableMessage {
	borrow_stable: {
		borrow_amount: string;
		to: string;
	};
}

export interface RepayStableMessage {
	repay_stable: object;
}

export interface PriceFeedMessage {
	feed_price: {
		prices: Array<[string, string]>;
	};
}

export interface LiquidationMessage {
	liquidate_collateral: {
		borrower: string;
	};
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

/**
 * Checks if a provided `msg` is of type `LockCollateralMessage`.
 */
export function isLockCollateralMessage(msg: any): msg is LockCollateralMessage {
	return msg["lock_collateral" as keyof typeof msg] !== undefined;
}

/**
 * Checks if a provided `msg` is of type `UnlockCollateralMessage`.
 */
export function isUnlockCollateralMessage(msg: any): msg is UnlockCollateralMessage {
	return msg["unlock_collateral" as keyof typeof msg] !== undefined;
}
