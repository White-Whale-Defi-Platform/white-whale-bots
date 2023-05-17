import BigNumber from "bignumber.js";

import { Uint128 } from "./uint128";

BigNumber.config({
	ROUNDING_MODE: BigNumber.ROUND_DOWN,
	EXPONENTIAL_AT: [-10, 20],
});

export interface Asset {
	amount: Uint128;
	info: AssetInfo;
}

export type AssetInfo = NativeAssetInfo | TokenAssetInfo;
export interface NativeAssetInfo {
	native_token: { denom: string };
}
export interface TokenAssetInfo {
	token: { contract_addr: string };
}

export interface WyndDaoNativeAssetInfo {
	native: string;
}
export interface WyndDaoTokenAssetInfo {
	token: string;
}
export interface JunoSwapCW20 {
	cw20: string;
}
export interface JunoSwapNative {
	native: string;
}
export type JunoSwapAssetInfo = JunoSwapNative | JunoSwapCW20;
/**
 * Checks to see if a given `info` is a native token.
 * @param info The `AssetInfo` to check.
 * @returns If the given `info` was a native token.
 */
export function isNativeAsset(info: AssetInfo): info is NativeAssetInfo {
	return info["native_token" as keyof typeof info] !== undefined;
}

/**
 *
 */
export function isWyndDaoNativeAsset(info: any): info is WyndDaoNativeAssetInfo {
	return info["native" as keyof typeof info] !== undefined && info.native["denom" as keyof typeof info] === undefined;
}

/**
 *
 */
export function isWyndDaoTokenAsset(info: any): info is WyndDaoTokenAssetInfo {
	return (
		info["token" as keyof typeof info] !== undefined &&
		info.token["contract_addr" as keyof typeof info] === undefined
	);
}

/**
 *
 */
export function isJunoSwapNativeAssetInfo(info: JunoSwapAssetInfo | JunoSwapCW20): info is JunoSwapNative {
	return info["native" as keyof typeof info] !== undefined;
}

/**
 * Checks to see if a given asset is the same as another asset, by comparing the underlying info.
 *
 * @param a The first asset to check.
 * @param b The second asset to check.
 * @returns If the assets are the same.
 */
export function isMatchingAssetInfos(a: AssetInfo, b: AssetInfo) {
	if (isNativeAsset(a)) {
		return isNativeAsset(b) && a.native_token.denom === b.native_token.denom;
	} else {
		return !isNativeAsset(b) && a.token.contract_addr === b.token.contract_addr;
	}
}

/**
 *
 */
export function toChainAsset(input: Asset): Asset {
	if (isNativeAsset(input.info) && input.info.native_token.denom === "inj") {
		return {
			amount: new BigNumber(+input.amount).multipliedBy(new BigNumber(10).pow(12)).toFixed(),
			info: input.info,
		};
	} else
		return {
			amount: String(Math.floor(+input.amount)),
			info: input.info,
		};
}

/**
 *
 */
export function fromChainAsset(input: Asset): Asset {
	if (isNativeAsset(input.info) && input.info.native_token.denom === "inj") {
		return {
			amount: new BigNumber(+input.amount).dividedBy(new BigNumber(10).pow(12)).toFixed(6),
			info: input.info,
		};
	} else if (isWyndDaoNativeAsset(input.info)) {
		return {
			amount: input.amount,
			info: { native_token: { denom: input.info.native } },
		};
	} else if (isWyndDaoTokenAsset(input.info)) {
		return {
			amount: input.amount,
			info: { token: { contract_addr: input.info.token } },
		};
	} else {
		return input;
	}
}

/**
 *
 */
export function toChainPrice(input: Asset, output: Asset): string {
	const inputChain = toChainAsset(input);
	const outputChain = toChainAsset(output);
	if (isMatchingAssetInfos(inputChain.info, outputChain.info)) {
		return new BigNumber(inputChain.amount).dividedBy(outputChain.amount).toFixed(6);
	} else if (isNativeAsset(outputChain.info) && outputChain.info.native_token.denom === "inj") {
		return new BigNumber(inputChain.amount).dividedBy(outputChain.amount).toFixed(18);
	} else {
		return new BigNumber(inputChain.amount).dividedBy(outputChain.amount).toFixed(6);
	}
}
