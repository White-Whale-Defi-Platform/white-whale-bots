import { fromBase64, fromUtf8 } from "@cosmjs/encoding";
import { ChainGrpcWasmApi, toBase64 } from "@injectivelabs/sdk-ts";

import { ChainOperator, InjectiveClients } from "../../../core/node/chainoperator";
import { Asset, AssetInfo, isNativeAsset } from "../../../core/types/base/asset";
import { AmmDexName, Pool } from "../../../core/types/base/pool";
import { Uint128 } from "../../../core/types/base/uint128";
import { identity } from "../../../core/types/identity";

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
 *
 */
export async function getPoolState(chainOperator: ChainOperator, pools: Array<Pool>) {
	const wasmClient = (<InjectiveClients>chainOperator.clients).WasmQueryClient;
	await Promise.all(
		pools.map(async (pool) => {
			const poolStateQueryResult = await wasmClient.fetchSmartContractState(pool.address, toBase64({ pool: {} }));
			const poolState: PoolState = JSON.parse(fromUtf8(fromBase64(String(poolStateQueryResult.data))));
			const assetsToUse = poolState.assets;
			if (isNativeAsset(poolState.assets[0].info) && poolState.assets[0].info.native_token.denom === "inj") {
				// using 18 decimals
				assetsToUse[0].amount = String(Math.round(+assetsToUse[0].amount / 1e12));
			}
			if (isNativeAsset(poolState.assets[1].info) && poolState.assets[1].info.native_token.denom === "inj") {
				// using 18 decimals
				assetsToUse[1].amount = String(Math.round(+assetsToUse[1].amount / 1e12));
			}
			pool.assets = assetsToUse;
			return;
		}),
	);
}

/**
 *
 */
export async function initPools(
	chainOperator: ChainOperator,
	poolAddresses: Array<{ pool: string; inputfee: number; outputfee: number; LPratio: number }>,
	factoryMapping: Array<{ factory: string; router: string }>,
) {
	const wasmClient = (<InjectiveClients>chainOperator.clients).WasmQueryClient;
	const pools: Array<Pool> = [];
	const factoryPools = await getPoolsFromFactory(wasmClient, factoryMapping);
	for (const poolEnv of poolAddresses) {
		const factory = factoryPools.find((fp) => fp.pool == poolEnv.pool)?.factory;
		const router = factoryPools.find((fp) => fp.pool == poolEnv.pool)?.router;
		const poolStateQueryResult = await wasmClient.fetchSmartContractState(poolEnv.pool, toBase64({ pool: {} }));
		const poolState: PoolState = JSON.parse(fromUtf8(fromBase64(String(poolStateQueryResult.data))));

		const assetsToUse = poolState.assets;
		if (isNativeAsset(poolState.assets[0].info) && poolState.assets[0].info.native_token.denom === "inj") {
			// using 18 decimals
			assetsToUse[0].amount = String(Math.round(+assetsToUse[0].amount / 1e12));
		}
		if (isNativeAsset(poolState.assets[1].info) && poolState.assets[1].info.native_token.denom === "inj") {
			// using 18 decimals
			assetsToUse[1].amount = String(Math.round(+assetsToUse[1].amount / 1e12));
		}
		const pool: Pool = identity<Pool>({
			assets: assetsToUse,
			totalShare: poolState.total_share,
			address: poolEnv.pool,
			dexname: AmmDexName.default,
			inputfee: poolEnv.inputfee,
			outputfee: poolEnv.outputfee,
			LPratio: poolEnv.LPratio,
			factoryAddress: factory ?? "",
			routerAddress: router ?? "",
		});
		pools.push(pool);
	}
	return pools;
}

/**
 *
 */
export async function getPoolsFromFactory(
	wasmClient: ChainGrpcWasmApi,
	factoryMapping: Array<{ factory: string; router: string }>,
): Promise<Array<{ pool: string; factory: string; router: string }>> {
	const factorypairs: Array<{ pool: string; factory: string; router: string }> = [];
	await Promise.all(
		factoryMapping.map(async (factorymap) => {
			let pairStateQueryResult = await wasmClient.fetchSmartContractState(
				factorymap.factory,
				toBase64({ pairs: { limit: 30 } }),
			);
			let factoryMapping: FactoryState = JSON.parse(fromUtf8(fromBase64(String(pairStateQueryResult.data))));
			factoryMapping.pairs.map((factorypair) => {
				factorypairs.push({
					pool: factorypair.contract_addr,
					factory: factorymap.factory,
					router: factorymap.router,
				});
			});

			while (factoryMapping.pairs.length == 30) {
				const start_after = factoryMapping.pairs[factoryMapping.pairs.length - 1].asset_infos;
				pairStateQueryResult = await wasmClient.fetchSmartContractState(
					factorymap.factory,
					toBase64({ pairs: { limit: 30, start_after: start_after } }),
				);
				factoryMapping = JSON.parse(fromUtf8(fromBase64(String(pairStateQueryResult.data))));

				factoryMapping.pairs.map((factorypair) => {
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
