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
