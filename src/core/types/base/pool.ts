import { isSendMessage } from "../messages/sendmessages";
import {
	isAstroSwapOperationsMessages,
	isJunoSwapMessage,
	isJunoSwapOperationsMessage,
	isSwapMessage,
	isSwapOperationsMessage,
	isTFMSwapOperationsMessage,
	isWWSwapOperationsMessages,
	isWyndDaoSwapOperationsMessages,
} from "../messages/swapmessages";
import { Asset, AssetInfo, isMatchingAssetInfos, isWyndDaoNativeAsset } from "./asset";
import { MempoolTrade } from "./mempool";
import { Path } from "./path";
import { Uint128 } from "./uint128";

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
	const k = +pool.assets[0].amount * +pool.assets[1].amount;
	const [asset_in, asset_out] = getAssetsOrder(pool, offer_asset.info) ?? [];
	const a_in = +asset_in.amount;
	const a_out = +asset_out.amount;
	if (pool.inputfee > 0) {
		// pool uses inputfees
		const r1 = 1 - pool.inputfee / 100;
		const amount_in_after_fee = Math.floor(+offer_asset.amount * r1);
		const outGivenIn = Math.floor(a_out - k / (a_in + amount_in_after_fee));
		return [outGivenIn, asset_out.info];
	} else {
		const r2 = 1 - pool.outputfee / 100;
		const outGivenIn = Math.floor(r2 * Math.floor(a_out - k / (a_in + +offer_asset.amount)));
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
 * @param mempool An array of MempoolTrades with relevant mempool messages.
 */
export function applyMempoolTradesOnPools(pools: Array<Pool>, mempoolTrades: Array<MempoolTrade>) {
	// Filter the trades in the mempool to only process the ones on pools we are tracking
	const filteredTrades = mempoolTrades.filter(
		(trade) =>
			pools.find((pool) => pool.routerAddress === trade.contract || pool.address === trade.contract) !==
			undefined,
	);
	for (const trade of filteredTrades) {
		const poolToUpdate = pools.find((pool) => trade.contract === pool.address);
		const msg = trade.message;
		if (poolToUpdate) {
			// a direct swap or send to pool
			if (isSwapMessage(msg) && trade.offer_asset !== undefined) {
				applyTradeOnPool(poolToUpdate, trade.offer_asset);
			} else if (isSendMessage(msg) && trade.offer_asset !== undefined) {
				console.log("---".repeat(10), "decoding send message", "---".repeat(10));
				console.log(trade);
				console.log(
					poolToUpdate.address,
					poolToUpdate.assets.map((asset) => asset.info),
				);
				applyTradeOnPool(poolToUpdate, trade.offer_asset);
			} else if (isJunoSwapMessage(msg) && trade.offer_asset === undefined) {
				// For JunoSwap messages we dont have an offerAsset provided in the message
				const offerAsset: Asset = {
					amount: msg.swap.input_amount,
					info: msg.swap.input_token === "Token1" ? poolToUpdate.assets[0].info : poolToUpdate.assets[1].info,
				};
				applyTradeOnPool(poolToUpdate, offerAsset);
			} else if (isJunoSwapOperationsMessage(msg) && trade.offer_asset === undefined) {
				// JunoSwap operations router message
				// For JunoSwap messages we dont have an offerAsset provided in the message
				const offerAsset: Asset = {
					amount: msg.pass_through_swap.input_token_amount,
					info:
						msg.pass_through_swap.input_token === "Token1"
							? poolToUpdate.assets[0].info
							: poolToUpdate.assets[1].info,
				};
				applyTradeOnPool(poolToUpdate, offerAsset);

				// Second swap
				const [outGivenIn0, nextOfferAssetInfo] = outGivenIn(poolToUpdate, offerAsset);
				const secondPoolToUpdate = pools.find(
					(pool) => pool.address === msg.pass_through_swap.output_amm_address,
				);

				if (secondPoolToUpdate !== undefined) {
					applyTradeOnPool(secondPoolToUpdate, { amount: String(outGivenIn0), info: nextOfferAssetInfo });
				}
			} else if (isTFMSwapOperationsMessage(msg) && trade.offer_asset !== undefined) {
				let offerAsset: Asset = trade.offer_asset;
				for (const operation of msg.execute_swap_operations.routes[0].operations) {
					const currentPool = pools.find((pool) => pool.address === operation.t_f_m_swap.pair_contract);
					if (currentPool) {
						const [outGivenInNext, offerAssetInfoNext] = outGivenIn(currentPool, offerAsset);
						applyTradeOnPool(currentPool, offerAsset);
						offerAsset = { amount: String(outGivenInNext), info: offerAssetInfoNext };
					}
				}
			}
		}
		// not a direct swap or swaps on pools, but a routed message using a Router contract
		else if (isSwapOperationsMessage(msg) && trade.offer_asset !== undefined) {
			const poolsFromThisRouter = pools.filter((pool) => trade.contract === pool.routerAddress);
			if (poolsFromThisRouter) {
				let offerAsset: Asset = trade.offer_asset;
				const operations = msg.execute_swap_operations.operations;
				if (isWWSwapOperationsMessages(operations)) {
					// terraswap router
					for (const operation of operations) {
						const currentPool = findPoolByInfos(
							poolsFromThisRouter,
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
					// astropoart router
					for (const operation of operations) {
						const currentPool = findPoolByInfos(
							poolsFromThisRouter,
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
					for (const operation of operations) {
						const offerAssetInfo = isWyndDaoNativeAsset(operation.wyndex_swap.offer_asset_info)
							? { native_token: { denom: operation.wyndex_swap.offer_asset_info.native } }
							: { token: { contract_addr: operation.wyndex_swap.offer_asset_info.token } };
						const askAssetInfo = isWyndDaoNativeAsset(operation.wyndex_swap.ask_asset_info)
							? { native_token: { denom: operation.wyndex_swap.ask_asset_info.native } }
							: { token: { contract_addr: operation.wyndex_swap.ask_asset_info.token } };
						const currentPool = findPoolByInfos(poolsFromThisRouter, offerAssetInfo, askAssetInfo);
						if (currentPool !== undefined) {
							console.log("---".repeat(10), "decoding wynddao swap operations message", "---".repeat(10));
							console.log(
								currentPool.assets.map((asset) => asset.info),
								offerAsset,
							);
							applyTradeOnPool(currentPool, offerAsset);
							const [outGivenInNext, offerAssetInfoNext] = outGivenIn(currentPool, offerAsset);
							offerAsset = { amount: String(outGivenInNext), info: offerAssetInfoNext };
						}
					}
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
