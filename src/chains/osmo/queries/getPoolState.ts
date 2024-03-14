import { fromAscii, fromBase64 } from "@cosmjs/encoding";
import { Pool as CLPool } from "osmojs/dist/codegen/osmosis/concentratedliquidity/v1beta1/pool";
import { CosmWasmPool as CosmWasmPool } from "osmojs/dist/codegen/osmosis/cosmwasmpool/v1beta1/model/pool";
import { Pool as StableswapPool } from "osmojs/dist/codegen/osmosis/gamm/poolmodels/stableswap/v1beta1/stableswap_pool";
import { Pool as BalancerPool } from "osmojs/dist/codegen/osmosis/gamm/v1beta1/balancerPool";

import OsmosisAdapter from "../../../core/chainOperator/chainAdapters/osmosis";
import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import {
	Asset,
	AssetInfo,
	fromChainAsset,
	isWyndDaoNativeAsset,
	isWyndDaoTokenAsset,
	RichAsset,
} from "../../../core/types/base/asset";
import { AmmDexName, DefaultPool, OsmosisDefaultPool, PairType, PCLPool, Pool } from "../../../core/types/base/pool";
import { Uint128 } from "../../../core/types/base/uint128";
import { getPoolStates as getPoolStatesDefault } from "../../defaults";

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
	const allPools = await (<OsmosisAdapter>chainOperator.client).allPools();
	for (const pool of allPools.pools) {
		if (<string>pool.$typeUrl === "/osmosis.gamm.v1beta1.Pool") {
			const poolToUpdate = pools.find((pa) => pa.address === (<BalancerPool>pool).address);
			if (poolToUpdate) {
				poolToUpdate.assets = initBalancerPool(<BalancerPool>pool).assets;
			}
		}
	}
	const otherPools = pools.filter((pool) => pool.dexname === AmmDexName.default);

	await getPoolStatesDefault(chainOperator, otherPools);
}

/**
 * Initializes the pools based on a queryclient with wasmextension.
 * @param client The cosmwasm client to send requests from, including wasmextension.
 * @param poolAddresses An array of objects (set by environment variables) holding the pooladdress, its inputfee and its outputfee.
 * @param factoryMapping An array of objects (set by environment variables) holding the mapping between factories and their routers.
 * @returns An array of instantiated Pool objects.
 */
export async function initPools(chainOperator: ChainOperator): Promise<Array<Pool>> {
	const allPools = await (<OsmosisAdapter>chainOperator.client).allPools();
	const osmosisPools: Array<Pool> = [];
	for (const pool of allPools.pools) {
		const q = <string>pool.$typeUrl;
		let derivedPool: CosmWasmPool | BalancerPool | CLPool | StableswapPool | Pool | undefined;
		switch (q) {
			case "/osmosis.cosmwasmpool.v1beta1.CosmWasmPool":
				derivedPool = await initOsmosisCosmWasmPool(chainOperator, <CosmWasmPool>pool);
				// // console.log(derivedPool);
				if (derivedPool) {
					const derivedOsmosisPool: OsmosisDefaultPool = {
						...derivedPool,
						weights: [50, 50],
						id: Number((<CosmWasmPool>pool).poolId),
					};
					osmosisPools.push(derivedOsmosisPool);
				}
				break;
			case "/osmosis.gamm.v1beta1.Pool":
				derivedPool = <BalancerPool>pool;
				if (
					derivedPool.poolAssets.length === 2 &&
					+derivedPool.poolAssets[0].token.amount > 1e6 &&
					+derivedPool.poolAssets[1].token.amount > 1e6
				) {
					osmosisPools.push(initBalancerPool(derivedPool));
				}
				break;
			case "/osmosis.concentratedliquidity.v1beta1.Pool":
				// console.log("found CL pool");
				derivedPool = <CLPool>pool;
				// console.log(derivedPool);
				break;
			case "/osmosis.gamm.poolmodels.stableswap.v1beta1.Pool":
				// console.log("found stableswap pool");
				derivedPool = <StableswapPool>pool;

				break;
			default:
				derivedPool = undefined;
				break;
		}
	}
	return osmosisPools;
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
function initBalancerPool(poolState: BalancerPool): OsmosisDefaultPool {
	/**
	 **/
	const poolAssets = poolState.poolAssets.map((asset): RichAsset => {
		return fromChainAsset({ amount: asset.token.amount, info: { native_token: { denom: asset.token.denom } } });
	});
	const poolWeights = poolState.poolAssets.map((asset) => +asset.weight);
	return {
		assets: poolAssets,
		address: poolState.address,
		totalShare: poolState.totalShares.amount,
		dexname: AmmDexName.osmosis,
		pairType: PairType.xyk,
		inputfee: +poolState.poolParams.swapFee,
		outputfee: 0,
		factoryAddress: "",
		routerAddress: "",
		LPratio: 1,
		id: Number(poolState.id),
		weights: poolWeights,
	};
}

/**
 *
 */
async function initOsmosisCosmWasmPool(chainOperator: ChainOperator, cwpool: CosmWasmPool) {
	const wwconfig = await chainOperator.queryContractSmart(cwpool.contractAddress, { get_config: {} });
	if (wwconfig["white_whale_pool" as keyof typeof wwconfig] !== undefined) {
		return await initPool(chainOperator, wwconfig.white_whale_pool);
	} else {
		const astroconfig = await chainOperator.queryContractSmart(cwpool.contractAddress, { config: {} });
		if (astroconfig["params" as keyof typeof astroconfig] !== undefined) {
			return await initPool(chainOperator, cwpool.contractAddress);
		}
	}
	console.error("Unable to initialize pool: ", cwpool.contractAddress);
	return undefined;
}
/**
 *
 */
async function initPool(chainOperator: ChainOperator, pooladdress: string): Promise<Pool | undefined> {
	let pairType: PairType;
	let defaultPool;
	try {
		pairType = await initPairType(chainOperator, pooladdress);
		defaultPool = await initDefaultPool(chainOperator, pooladdress);
	} catch (e) {
		console.error("Unable to initialize pool: ", pooladdress);
		return undefined;
	}
	if (pairType === PairType.pcl && defaultPool) {
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
