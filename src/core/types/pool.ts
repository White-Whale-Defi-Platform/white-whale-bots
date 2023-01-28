import { isSendMessage } from "./messages/sendmessages";
import {
	isAstroSwapOperationsMessages,
	isJunoSwapMessage,
	isJunoSwapOperationsMessage,
	isSwapMessage,
	isSwapOperationsMessage,
	isTFMSwapOperationsMessage,
	isWWSwapOperationsMessages,
} from "./messages/swapmessages";
import { Asset, AssetInfo, isMatchingAssetInfos } from "./asset";
import { MempoolTrade } from "./mempool";
import { Uint128 } from "./uint128";

export interface Pool {
	/**
	 * The two assets that can be swapped between in the pool.
	 */
	assets: [Asset, Asset];
	/**
	 * The total amount of LP tokens that exist.
	 */
	totalShare: Uint128;
	/**
	 * The address of the pool.
	 */
	address: string;

	type: string;
	fee: number;
	factoryAddress: string;
	routerAddress: string;
}

/**
 *
 */
export function outGivenIn(pool: Pool, inputAsset: Asset): [number, AssetInfo] {
	const SWAP_FEE = pool.fee / 100;
	if (isMatchingAssetInfos(pool.assets[0].info, inputAsset.info)) {
		// asset[0] from pool is inputasset

		return [
			Math.floor(
				(1 - SWAP_FEE) *
					((+pool.assets[1].amount * +inputAsset.amount) / (+pool.assets[0].amount + +inputAsset.amount)),
			),
			pool.assets[1].info,
		];
	} else {
		return [
			Math.floor(
				(1 - SWAP_FEE) *
					((+pool.assets[0].amount * +inputAsset.amount) / (+pool.assets[1].amount + +inputAsset.amount)),
			),
			pool.assets[0].info,
		];
	}
}

/**
 *
 */
function applyTradeOnPool(pool: Pool, offer_asset: Asset) {
	if (isMatchingAssetInfos(pool.assets[0].info, offer_asset.info)) {
		pool.assets[0].amount = String(+pool.assets[0].amount + +offer_asset.amount);
		pool.assets[1].amount = String(+pool.assets[1].amount - +outGivenIn(pool, offer_asset)[0]);
	} else {
		pool.assets[1].amount = String(+pool.assets[1].amount + +offer_asset.amount);
		pool.assets[0].amount = String(+pool.assets[0].amount - +outGivenIn(pool, offer_asset)[0]);
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
				// Normal swapmessage
				applyTradeOnPool(poolToUpdate, trade.offer_asset);
			} else if (isSendMessage(msg) && trade.offer_asset !== undefined) {
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
export function routeBetweenPools(poolA: Pool, poolB: Pool): boolean {
	const match0 = isMatchingAssetInfos(poolA.assets[0].info, poolB.assets[0].info) ? 1 : 0;
	const match1 = isMatchingAssetInfos(poolA.assets[1].info, poolB.assets[0].info) ? 1 : 0;
	const match2 = isMatchingAssetInfos(poolA.assets[1].info, poolB.assets[1].info) ? 1 : 0;
	const match3 = isMatchingAssetInfos(poolA.assets[0].info, poolB.assets[1].info) ? 1 : 0;

	const matched = match0 + match1 + match2 + match3;
	return matched == 1;
	// there is exactly 1 match, meaning we can travel from A to B through 1 asset. We want to exclude pools with exactly the same 2 assets
	// as they will be included in a 2 hop path.
}

/**
 *
 */
export function getAssetsOrder(pool: Pool, assetInfo: AssetInfo) {
	if (isMatchingAssetInfos(pool.assets[0].info, assetInfo)) {
		return [pool.assets[0], pool.assets[1]] as Array<Asset>;
	} else if (isMatchingAssetInfos(pool.assets[1].info, assetInfo)) {
		return [pool.assets[1], pool.assets[0]] as Array<Asset>;
	}
}
