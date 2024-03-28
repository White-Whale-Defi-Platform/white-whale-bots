import { fromAscii, fromBase64 } from "@cosmjs/encoding";

import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import {
	Asset,
	AssetInfo,
	fromChainAsset,
	isWyndDaoNativeAsset,
	isWyndDaoTokenAsset,
	RichAsset,
} from "../../../core/types/base/asset";
import { AmmDexName, DefaultPool, PairType, PCLPool, Pool } from "../../../core/types/base/pool";
import { Uint128 } from "../../../core/types/base/uint128";
import { getPoolsFromFactory } from "./getPoolsFromFactory";

interface PCLConfigResponse {
	block_time_last: number;
	params: string;
	owner: string;
	factory_addr: string;
	price_scale: string;
}

interface PCLConfigParams {
	amp: string;
	gamma: string;
	mid_fee: string;
	out_fee: string;
	fee_gamma: string;
	repeg_profit_threshold: string;
	min_price_scale_delta: string;
	price_scale: string;
	ma_half_time: number;
	track_asset_balances: boolean;
}

interface PoolState {
	assets: [Asset, Asset];
	total_share: Uint128;
}

interface PairResponse {
	asset_infos: Array<AssetInfo>;
	contract_addr: string;
	pair_type?: string | Record<string, string>;
}

/**
 * Retrieves the pool state of a given Terra address.
 * @param client The cosmwasm client to send requests from, including wasmextension.
 * @param pools An array of Pool objects to obtain the chain states for.
 */
export async function getPoolStates(chainOperator: ChainOperator, pools: Array<Pool>) {
	await Promise.all(
		pools.map(async (pool) => {
			if (pool.pairType === PairType.pcl) {
				const [poolState, d, config]: [PoolState, number, PCLConfigResponse] = await Promise.all([
					chainOperator.queryContractSmart(pool.address, {
						pool: {},
					}),
					chainOperator.queryContractSmart(pool.address, { compute_d: {} }),
					chainOperator.queryContractSmart(pool.address, {
						config: {},
					}),
				]);
				const pclPool: PCLPool = <PCLPool>pool;
				const configParams: PCLConfigParams = JSON.parse(fromAscii(fromBase64(config.params)));
				pclPool.D = Number(d);
				pclPool.amp = +configParams.amp;
				pclPool.gamma = +configParams.gamma;
				pclPool.priceScale = +configParams.price_scale;
				pclPool.feeGamma = +configParams.fee_gamma;
				pclPool.midFee = +configParams.mid_fee;
				pclPool.outFee = +configParams.out_fee;
				const [assets] = processPoolStateAssets(poolState);
				pool.assets = assets;
			} else {
				const poolState = <PoolState>await chainOperator.queryContractSmart(pool.address, {
					pool: {},
				});
				const [assets] = processPoolStateAssets(poolState);
				pool.assets = assets;
			}
		}),
	);
}

/**
 * Initializes the pools based on a queryclient with wasmextension.
 * @param client The cosmwasm client to send requests from, including wasmextension.
 * @param poolAddresses An array of objects (set by environment variables) holding the pooladdress, its inputfee and its outputfee.
 * @param factoryMapping An array of objects (set by environment variables) holding the mapping between factories and their routers.
 * @returns An array of instantiated Pool objects.
 */
export async function initPools(
	chainOperator: ChainOperator,
	poolAddresses: Array<{ pool: string; inputfee: number; outputfee: number; LPratio: number }>,
	factoryMapping: Array<{ factory: string; router: string }>,
	manualPoolsOnly = false,
): Promise<Array<Pool>> {
	const pools: Array<Pool> = [];
	const factoryPools = await getPoolsFromFactory(chainOperator, factoryMapping);
	for (const poolAddress of poolAddresses) {
		const pool: Pool | undefined = await initPool(chainOperator, poolAddress.pool);
		if (!pool) {
			continue;
		}
		const factory = factoryPools.find((fp) => fp.pool == poolAddress.pool)?.factory ?? "";
		const router = factoryPools.find((fp) => fp.pool == poolAddress.pool)?.router ?? "";

		(pool.inputfee = poolAddress.inputfee),
			(pool.outputfee = poolAddress.outputfee),
			(pool.LPratio = poolAddress.LPratio),
			(pool.factoryAddress = factory),
			(pool.routerAddress = router);
		pools.push(pool);
	}

	//if we allow factorypools we try instantiate all pools available from the factory
	if (!manualPoolsOnly) {
		//filter all factory pools with the ones we manually setup using POOLS env
		const filteredFactoryPools = factoryPools.filter(
			(fp) => poolAddresses.find((pa) => pa.pool === fp.pool) === undefined,
		);

		for (const factoryPool of filteredFactoryPools) {
			const pool: Pool | undefined = await initPool(chainOperator, factoryPool.pool);
			if (!pool) {
				continue;
			}
			pool.inputfee = 0;
			pool.outputfee = 0.3;
			pool.LPratio = 0.667;
			pool.factoryAddress = factoryPool.factory;
			pool.routerAddress = factoryPool.router;

			pools.push(pool);
		}
	}
	return pools;
}

/**
 *
 */
export function processPoolStateAssets(poolState: PoolState): [Array<RichAsset>, AmmDexName, string] {
	const assets: Array<RichAsset> = [];
	let type = AmmDexName.default;

	for (const assetState of poolState.assets) {
		if (isWyndDaoNativeAsset(assetState.info)) {
			assets.push(
				fromChainAsset({
					amount: assetState.amount,
					info: { native_token: { denom: assetState.info.native } },
				}),
			);
			type = AmmDexName.wyndex;
		} else if (isWyndDaoTokenAsset(assetState.info)) {
			assets.push(
				fromChainAsset({
					amount: assetState.amount,
					info: { token: { contract_addr: assetState.info.token } },
				}),
			);
			type = AmmDexName.wyndex;
		} else {
			assets.push(fromChainAsset(assetState));
		}
	}
	return [assets, type, poolState.total_share];
}

/**
 *
 */
async function initPool(chainOperator: ChainOperator, pooladdress: string): Promise<Pool | undefined> {
	const pairType = await initPairType(chainOperator, pooladdress);
	const defaultPool = await initDefaultPool(chainOperator, pooladdress);
	if (!defaultPool) {
		console.error("Unable to initialize pool: ", pooladdress);
		return undefined;
	}
	if (pairType === PairType.pcl) {
		return await initPCLPool(chainOperator, defaultPool);
	}
	return defaultPool;
	/**
	 *
	 */
	async function initDefaultPool(
		chainOperator: ChainOperator,
		pooladdress: string,
	): Promise<DefaultPool | undefined> {
		let assets: Array<RichAsset> = [];
		let dexname: AmmDexName;
		let totalShare: string;
		try {
			const poolState = <PoolState>await chainOperator.queryContractSmart(pooladdress, { pool: {} });

			if (
				poolState.total_share == "0" ||
				poolState.assets[0].amount == "0" ||
				poolState.assets[1].amount == "0"
			) {
				return undefined;
			}
			[assets, dexname, totalShare] = processPoolStateAssets(poolState);
		} catch (error) {
			console.log("error querying pool: ", pooladdress);
			console.log(error);
			return undefined;
		}
		const defaultPool: DefaultPool = {
			assets: assets,
			totalShare: totalShare,
			address: pooladdress,
			dexname: dexname,
			pairType: pairType,
			inputfee: 0,
			outputfee: 0,
			LPratio: 0,
			factoryAddress: "",
			routerAddress: "",
		};
		return defaultPool;
	}

	/**
	 *
	 */
	async function initPCLPool(chainOperator: ChainOperator, defaultPool: DefaultPool): Promise<PCLPool> {
		const d = Number(await chainOperator.queryContractSmart(defaultPool.address, { compute_d: {} }));
		const config: PCLConfigResponse = await chainOperator.queryContractSmart(defaultPool.address, { config: {} });
		const configParams: PCLConfigParams = JSON.parse(fromAscii(fromBase64(config.params)));
		return {
			...defaultPool,
			D: d,
			amp: +configParams.amp,
			gamma: +configParams.gamma,
			priceScale: +configParams.price_scale,
			feeGamma: +configParams.fee_gamma,
			midFee: +configParams.mid_fee,
			outFee: +configParams.out_fee,
		};
	}
	/**
	 *
	 */
	async function initPairType(chainOperator: ChainOperator, pooladdress: string): Promise<PairType> {
		try {
			const poolPairResponse: PairResponse = await chainOperator.queryContractSmart(pooladdress, {
				pair: {},
			});
			if (!poolPairResponse.pair_type) {
				return PairType.xyk;
			} else if (typeof poolPairResponse.pair_type === "string") {
				if (poolPairResponse.pair_type !== "constant_product") {
					return PairType.stable;
				}
			} else if (poolPairResponse.pair_type["custom"] === "concentrated") {
				return PairType.pcl;
			} else if (poolPairResponse.pair_type["stable"] !== undefined) {
				return PairType.stable;
			} else {
				return PairType.xyk;
			}
		} catch (e) {
			console.log("cannot detect pair type for: ", pooladdress, " defaulting to xyk");
			console.log(e);
			return PairType.xyk;
		}
		return PairType.xyk;
	}
}
