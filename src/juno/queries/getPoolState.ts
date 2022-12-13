import { WasmExtension } from "@cosmjs/cosmwasm-stargate";
import { QueryClient } from "@cosmjs/stargate";

import { BotClients } from "../../node/chainoperator";
import { Asset, AssetInfo } from "../../types/core/asset";
import { Pool } from "../../types/core/pool";
import { Uint128 } from "../../types/core/uint128";
import { identity } from "../../types/identity";

interface JunoSwapCW20 {
	cw20: string;
}
interface JunoSwapNative {
	native: string;
}
type JunoSwapAssetInfo = JunoSwapNative | JunoSwapCW20;

interface JunoSwapPoolState {
	token1_reserve: string;
	token1_denom: JunoSwapAssetInfo;
	token2_reserve: string;
	token2_denom: JunoSwapAssetInfo;
	lp_token_supply: string;
	lp_token_address: string;
}

interface PoolState {
	assets: [Asset, Asset];
	total_share: Uint128;
}

interface FactoryStatePair {
	asset_infos: Array<AssetInfo>;
	contract_addr: string;
	liquidity_token: string;
}
interface FactoryState {
	pairs: Array<FactoryStatePair>;
}

/**
 * Retrieves the pool state of a given Terra address.
 * @param client The cosmwasm client to send requests from.
 * @param address The Terra address to retrieve the pool state from.
 */
export async function getPoolStates(botClients: BotClients, pools: Array<Pool>) {
	await Promise.all(
		pools.map(async (pool) => {
			if (pool.type == "junoswap") {
				const poolState: JunoSwapPoolState = await botClients.WasmQueryClient.wasm.queryContractSmart(
					pool.address,
					{ info: {} },
				);
				pool.assets[0].amount = poolState.token1_reserve;
				pool.assets[1].amount = poolState.token2_reserve;
				return;
			} else {
				const poolState: PoolState = await botClients.WasmQueryClient.wasm.queryContractSmart(pool.address, {
					pool: {},
				});

				pool.assets = poolState.assets;
				return;
			}
		}),
	);
}

/**
 *
 */
export async function initPools(
	client: QueryClient & WasmExtension,
	poolAddresses: Array<{ pool: string; inputfee: number; outputfee: number }>,
	factoryMapping: Array<{ factory: string; router: string }>,
): Promise<Array<Pool>> {
	const pools: Array<Pool> = [];
	const factoryPools = await getPoolsFromFactory(client, factoryMapping);
	for (const poolAddress of poolAddresses) {
		let poolState: PoolState | JunoSwapPoolState;
		const factory = factoryPools.find((fp) => fp.pool == poolAddress.pool)?.factory;
		const router = factoryPools.find((fp) => fp.pool == poolAddress.pool)?.router;

		try {
			poolState = await client.wasm.queryContractSmart(poolAddress.pool, { pool: {} });
		} catch (error) {
			poolState = await client.wasm.queryContractSmart(poolAddress.pool, { info: {} });
		}
		if (isPoolState(poolState)) {
			const pool: Pool = identity<Pool>({
				assets: poolState.assets,
				totalShare: poolState.total_share,
				address: poolAddress.pool,
				type: "default",
				inputfee: poolAddress.inputfee,
				outputfee: poolAddress.outputfee,
				factoryAddress: factory ?? "",
				routerAddress: router ?? "",
			});
			pools.push(pool);
		} else {
			const asset1: Asset = {
				amount: String(poolState.token1_reserve),
				info: isJunoSwapAssetInfo(poolState.token1_denom)
					? { native_token: { denom: poolState.token1_denom.native } }
					: { token: { contract_addr: poolState.token1_denom.cw20 } },
			};
			const asset2: Asset = {
				amount: String(poolState.token2_reserve),
				info: isJunoSwapAssetInfo(poolState.token2_denom)
					? { native_token: { denom: poolState.token2_denom.native } }
					: { token: { contract_addr: poolState.token2_denom.cw20 } },
			};
			const pool: Pool = identity<Pool>({
				assets: [asset1, asset2],
				totalShare: String(poolState.lp_token_supply),

				address: poolAddress.pool,
				type: "junoswap",
				inputfee: poolAddress.inputfee,
				outputfee: poolAddress.outputfee,
				factoryAddress: factory ?? "",
				routerAddress: router ?? "",
			});
			pools.push(pool);
		}
	}
	return pools;
}

/**
 * Checks to see if a given `info` is a native token.
 * @param info The `AssetInfo` to check.
 * @returns If the given `info` was a native token.
 */
function isPoolState(state: PoolState | JunoSwapPoolState): state is PoolState {
	return state["total_share" as keyof typeof state] !== undefined;
}

/**
 *
 */
function isJunoSwapAssetInfo(info: JunoSwapAssetInfo | JunoSwapCW20): info is JunoSwapNative {
	return info["native" as keyof typeof info] !== undefined;
}

/**
 *
 */
export async function getPoolsFromFactory(
	client: QueryClient & WasmExtension,
	factoryMapping: Array<{ factory: string; router: string }>,
): Promise<Array<{ pool: string; factory: string; router: string }>> {
	const factorypairs: Array<{ pool: string; factory: string; router: string }> = [];
	await Promise.all(
		factoryMapping.map(async (factorymap) => {
			let res: FactoryState = await client.wasm.queryContractSmart(factorymap.factory, { pairs: { limit: 30 } });

			res.pairs.map((factorypair) => {
				factorypairs.push({
					pool: factorypair.contract_addr,
					factory: factorymap.factory,
					router: factorymap.router,
				});
			});

			while (res.pairs.length == 30) {
				const start_after = res.pairs[res.pairs.length - 1].asset_infos;
				res = await client.wasm.queryContractSmart(factorymap.factory, {
					pairs: { limit: 30, start_after: start_after },
				});

				res.pairs.map((factorypair) => {
					factorypairs.push({
						pool: factorypair.contract_addr,
						factory: factorymap.factory,
						router: factorymap.router,
					});
				});
			}
		}),
	);

	return factorypairs;
}
