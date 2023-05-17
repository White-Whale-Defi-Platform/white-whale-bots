import { fromAscii, fromBase64, fromUtf8 } from "@cosmjs/encoding";
import { BigNumber } from "bignumber.js";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { inspect } from "util";

import { isSendMessage } from "../messages/sendmessages";
import {
	isAstroSwapOperationsMessages,
	isDefaultSwapMessage,
	isJunoSwapMessage,
	isJunoSwapOperationsMessage,
	isSwapMessage,
	isSwapOperationsMessage,
	isTFMSwapOperationsMessage,
	isWWSwapOperationsMessages,
	isWyndDaoSwapOperationsMessages,
} from "../messages/swapmessages";
import { Asset, AssetInfo, fromChainAsset, isMatchingAssetInfos, isWyndDaoNativeAsset } from "./asset";
import { MempoolTx } from "./mempool";
import { Path } from "./path";
import { Uint128 } from "./uint128";
BigNumber.config({
	ROUNDING_MODE: BigNumber.ROUND_DOWN,
	EXPONENTIAL_AT: [-10, 20],
});

export enum AmmDexName {
	junoswap = "junoswap",
	default = "default",
	wyndex = "wyndex",
}
export enum ClobDexName {
	injective = "injective",
}
export interface Pool {
	/**
	 * The two assets that can be swapped between in the pool.
	 */
	assets: Array<Asset>;
	/**
	 * The total amount of LP tokens that exist.
	 */
	totalShare: Uint128;
	/**
	 * The address of the pool.
	 */
	address: string;

	dexname: AmmDexName;
	inputfee: number;
	outputfee: number;
	LPratio: number;
	factoryAddress: string;
	routerAddress: string;
}

/**
 * Function to calculate the expected received assets from a user perspective.
 * @param pool The pool to trade on.
 * @param offer_asset The offer asset the user wants to trade on the pool.
 * @return [number, assetInfo] of the received asset by the user.
 */
export function outGivenIn(pool: Pool, offer_asset: Asset): [number, AssetInfo] {
	const [asset_in, asset_out] = getAssetsOrder(pool, offer_asset.info) ?? [];
	const a_in = BigNumber(asset_in.amount);
	const a_out = BigNumber(asset_out.amount);
	const k = a_in.multipliedBy(a_out);
	if (pool.inputfee > 0) {
		// pool uses inputfees
		const r1 = BigNumber(BigNumber(1).minus(BigNumber(pool.inputfee).dividedBy(100)));
		const amount_in_after_fee = BigNumber(offer_asset.amount).multipliedBy(r1);
		const outGivenIn = a_out.minus(k.dividedBy(a_in.plus(amount_in_after_fee))).toNumber();
		return [outGivenIn, asset_out.info];
	} else {
		const r2 = BigNumber(1).minus(BigNumber(pool.outputfee).dividedBy(100));
		const outGivenIn = a_out
			.minus(k.dividedBy(a_in.plus(offer_asset.amount)))
			.multipliedBy(r2)
			.toNumber();
		return [outGivenIn, asset_out.info];
	}
}

/**
 * Function to apply a specific trade on a pool.
 * @param pool The pool to apply the trade on.
 * @param offer_asset The offer asset applied in the trade.
 */
function applyTradeOnPool(pool: Pool, offer_asset: Asset) {
	// K defines the constant product equilibrium
	const k = +pool.assets[0].amount * +pool.assets[1].amount;
	const [asset_in, asset_out] = getAssetsOrder(pool, offer_asset.info) ?? [];
	const a_in = +asset_in.amount;
	const a_out = +asset_out.amount;

	// Check if pool uses input fees
	if (pool.inputfee > 0) {
		// Calculate the r1: the input fee as a rate
		const r1 = 1 - pool.inputfee / 100;

		// Calculate the input amount after the fee reduction
		const amount_in_after_fee = Math.floor(+offer_asset.amount * r1);

		// Calculate the LP_fee_amount, this value will stay in the pool as fee for the LP providers
		const lp_fee_amount = Math.floor((+offer_asset.amount - Math.floor(amount_in_after_fee)) * pool.LPratio);

		// Calculate the return amount based on the xy=k formula and offer_asset minus the fees
		const outGivenIn = Math.floor(a_out - k / (a_in + amount_in_after_fee));

		// Update the assets of the pool
		asset_in.amount = String(a_in + Math.floor(amount_in_after_fee) + lp_fee_amount);
		asset_out.amount = String(a_out - outGivenIn);
	} else {
		//If pool uses output fees, calculate the rate of the fees that actually leave the pool: e.g. if the fee is 0.3%, of which 0.2% is LP fee, only .1% of the
		// fees paid by the user actually leave the pool. The other .2% of the fees remains in the pool as fee for the LP providers
		const outflowReducer = 1 - (pool.outputfee * pool.LPratio) / 100;

		// Calculate return amount without deducting fees
		const outGivenIn = Math.floor(a_out - k / (a_in + +offer_asset.amount));
		// Update the assets of the pool
		asset_in.amount = String(a_in + +offer_asset.amount);

		// The outGivenIn amount is reduced with the outflowReducer
		asset_out.amount = String(a_out - Math.floor(outGivenIn * outflowReducer));
	}
}
/**
 * Function to apply the mempoolTrades derived from the mempool on the list of tracked pools.
 * @param pools The pools the bot is tracking.
 * @param mempoolMessages An array of `MempoolTx` with relevant mempool messages.
 */
export function applyMempoolMessagesOnPools(pools: Array<Pool>, mempoolTxs: Array<MempoolTx>) {
	// Filter the trades in the mempool to only process the ones on pools we are tracking
	const swapsToProcess: Array<{ msg: MsgExecuteContract; pool: Pool }> = [];
	const swapOperationsToProcess: Array<{ msg: MsgExecuteContract; poolsFromRouter: Array<Pool> }> = [];
	for (const mempoolTx of mempoolTxs) {
		try {
			const decodedMsg = JSON.parse(fromUtf8(mempoolTx.message.msg));
			const poolToUpdate = pools.find(
				(pool) =>
					pool.address === mempoolTx.message.contract ||
					(isSendMessage(decodedMsg) && decodedMsg.send.contract === pool.address),
			);
			if (poolToUpdate) {
				swapsToProcess.push({ msg: mempoolTx.message, pool: poolToUpdate });
			} else {
				const poolsFromRouter = pools.filter(
					(pool) =>
						pool.routerAddress === mempoolTx.message.contract ||
						(isSendMessage(decodedMsg) && decodedMsg.send.contract === pool.routerAddress),
				);
				if (poolsFromRouter.length > 0) {
					swapOperationsToProcess.push({ msg: mempoolTx.message, poolsFromRouter: poolsFromRouter });
				} else if (isTFMSwapOperationsMessage(decodedMsg)) {
					//tfm swap uses all known pools
					swapOperationsToProcess.push({ msg: mempoolTx.message, poolsFromRouter: pools });
				}
			}
		} catch (e) {
			console.log(e);
			console.log("cannot apply mempool message on pool: \n", inspect(mempoolTx.message, true, null, true));
			continue;
		}
	}

	for (const swapMsg of swapsToProcess) {
		try {
			applySwapMsg(swapMsg.pool, swapMsg.msg, pools);
		} catch (e) {
			console.log("cannot apply swap message");
			console.log(swapMsg.pool, inspect(JSON.parse(fromUtf8(swapMsg.msg.msg)), true, null, true));
			continue;
		}
	}

	for (const swapOperationsMsg of swapOperationsToProcess) {
		try {
			applySwapOperationMsg(swapOperationsMsg.poolsFromRouter, swapOperationsMsg.msg);
		} catch (e) {
			console.log("cannot apply swap operations message");
			console.log(inspect(JSON.parse(fromUtf8(swapOperationsMsg.msg.msg)), true, null, true));
			continue;
		}
	}
}
/**
 *
 */
function applySwapMsg(pool: Pool, msg: MsgExecuteContract, pools: Array<Pool>) {
	const decodedMsg = JSON.parse(fromUtf8(msg.msg));
	if (isDefaultSwapMessage(decodedMsg)) {
		const offerAsset = fromChainAsset(decodedMsg.swap.offer_asset);
		applyTradeOnPool(pool, offerAsset);
	} else if (isJunoSwapMessage(decodedMsg)) {
		const offerAsset: Asset = fromChainAsset({
			amount: decodedMsg.swap.input_amount,
			info: decodedMsg.swap.input_token === "Token1" ? pool.assets[0].info : pool.assets[1].info,
		});
		applyTradeOnPool(pool, offerAsset);
	} else if (isSendMessage(decodedMsg)) {
		try {
			const msgJson = JSON.parse(fromAscii(fromBase64(decodedMsg.send.msg)));
			if (isSwapMessage(msgJson)) {
				const offerAsset = fromChainAsset({
					amount: decodedMsg.send.amount,
					info: { token: { contract_addr: msg.contract } },
				});
				applyTradeOnPool(pool, offerAsset);
			}
		} catch (e) {
			console.log("cannot apply send message: \n", e);
			console.log(decodedMsg.send);
		}
	} else if (isJunoSwapOperationsMessage(decodedMsg)) {
		const offerAsset: Asset = fromChainAsset({
			amount: decodedMsg.pass_through_swap.input_token_amount,
			info: decodedMsg.pass_through_swap.input_token === "Token1" ? pool.assets[0].info : pool.assets[1].info,
		});
		applyTradeOnPool(pool, offerAsset);

		// Second swap
		const [outGivenIn0, nextOfferAssetInfo] = outGivenIn(pool, offerAsset);
		const secondPoolToUpdate = pools.find(
			(pool) => pool.address === decodedMsg.pass_through_swap.output_amm_address,
		);

		if (secondPoolToUpdate !== undefined) {
			applyTradeOnPool(secondPoolToUpdate, { amount: String(outGivenIn0), info: nextOfferAssetInfo });
		}
	}
}
/**
 *
 */
function applySwapOperationMsg(poolsFromRouter: Array<Pool>, msg: MsgExecuteContract) {
	const decodedMsg = JSON.parse(fromUtf8(msg.msg));

	if (isTFMSwapOperationsMessage(decodedMsg)) {
		let offerAsset = fromChainAsset({
			amount: decodedMsg.execute_swap_operations.routes[0].offer_amount,
			info: decodedMsg.execute_swap_operations.routes[0].operations[0].t_f_m_swap.offer_asset_info,
		});

		for (const operation of decodedMsg.execute_swap_operations.routes[0].operations) {
			const currentPool = poolsFromRouter.find((pool) => pool.address === operation.t_f_m_swap.pair_contract);
			if (currentPool) {
				const [outGivenInNext, offerAssetInfoNext] = outGivenIn(currentPool, offerAsset);
				applyTradeOnPool(currentPool, offerAsset);
				offerAsset = { amount: String(outGivenInNext), info: offerAssetInfoNext };
			}
		}
	} else if (isSwapOperationsMessage(decodedMsg)) {
		const operations = decodedMsg.execute_swap_operations.operations;
		const initialAmount = msg.funds[0].amount;
		if (isWWSwapOperationsMessages(operations)) {
			let offerAsset: Asset = fromChainAsset({
				amount: initialAmount,
				info: operations[0].terra_swap.offer_asset_info,
			});
			// terraswap router
			for (const operation of operations) {
				const currentPool = findPoolByInfos(
					poolsFromRouter,
					operation.terra_swap.offer_asset_info,
					operation.terra_swap.ask_asset_info,
				);

				if (currentPool !== undefined) {
					applyTradeOnPool(currentPool, offerAsset);
					const [outGivenInNext, offerAssetInfoNext] = outGivenIn(currentPool, offerAsset);
					offerAsset = { amount: String(outGivenInNext), info: offerAssetInfoNext };
				}
			}
		}
		if (isAstroSwapOperationsMessages(operations)) {
			let offerAsset: Asset = fromChainAsset({
				amount: initialAmount,
				info: operations[0].astro_swap.offer_asset_info,
			});
			// astropoart router
			for (const operation of operations) {
				const currentPool = findPoolByInfos(
					poolsFromRouter,
					operation.astro_swap.offer_asset_info,
					operation.astro_swap.ask_asset_info,
				);
				if (currentPool !== undefined) {
					applyTradeOnPool(currentPool, offerAsset);
					const [outGivenInNext, offerAssetInfoNext] = outGivenIn(currentPool, offerAsset);
					offerAsset = { amount: String(outGivenInNext), info: offerAssetInfoNext };
				}
			}
		}
		if (isWyndDaoSwapOperationsMessages(operations)) {
			let offerAsset: Asset;
			if (isWyndDaoNativeAsset(operations[0].wyndex_swap.offer_asset_info)) {
				offerAsset = {
					amount: initialAmount,
					info: {
						native_token: { denom: operations[0].wyndex_swap.offer_asset_info.native },
					},
				};
			} else {
				offerAsset = {
					amount: initialAmount,
					info: {
						token: { contract_addr: operations[0].wyndex_swap.offer_asset_info.token },
					},
				};
			}
			for (const operation of operations) {
				const offerAssetInfo = isWyndDaoNativeAsset(operation.wyndex_swap.offer_asset_info)
					? { native_token: { denom: operation.wyndex_swap.offer_asset_info.native } }
					: { token: { contract_addr: operation.wyndex_swap.offer_asset_info.token } };
				const askAssetInfo = isWyndDaoNativeAsset(operation.wyndex_swap.ask_asset_info)
					? { native_token: { denom: operation.wyndex_swap.ask_asset_info.native } }
					: { token: { contract_addr: operation.wyndex_swap.ask_asset_info.token } };
				const currentPool = findPoolByInfos(poolsFromRouter, offerAssetInfo, askAssetInfo);
				if (currentPool !== undefined) {
					applyTradeOnPool(currentPool, offerAsset);
					const [outGivenInNext, offerAssetInfoNext] = outGivenIn(currentPool, offerAsset);
					offerAsset = { amount: String(outGivenInNext), info: offerAssetInfoNext };
				}
			}
		}
	}
}

/**
 *
 */
function findPoolByInfos(pools: Array<Pool>, infoA: AssetInfo, infoB: AssetInfo) {
	const matchedPools = pools.filter(
		(pool) =>
			(isMatchingAssetInfos(pool.assets[0].info, infoA) && isMatchingAssetInfos(pool.assets[1].info, infoB)) ||
			(isMatchingAssetInfos(pool.assets[0].info, infoB) && isMatchingAssetInfos(pool.assets[1].info, infoA)),
	);
	return matchedPools[0];
}

/**
 *
 */
export function getAssetsOrder(pool: Pool, assetInfo: AssetInfo) {
	if (isMatchingAssetInfos(pool.assets[0].info, assetInfo)) {
		return [pool.assets[0], pool.assets[1]] as Array<Asset>;
	} else if (isMatchingAssetInfos(pool.assets[1].info, assetInfo)) {
		return [pool.assets[1], pool.assets[0]] as Array<Asset>;
	} else {
		return undefined;
	}
}

/**
 * Function to remove pools that are not used in paths.
 * @param pools Array of Pool types to check for filtering.
 * @param paths Array of Path types to check the pools against.
 * @returns Filtered array of Pools.
 */
export function removedUnusedPools(pools: Array<Pool>, paths: Array<Path>): Array<Pool> {
	const filteredPools: Set<Pool> = new Set(
		pools.filter((pool) => paths.some((path) => path.pools.some((pathPool) => pathPool.address === pool.address))),
	);
	return [...filteredPools];
}
