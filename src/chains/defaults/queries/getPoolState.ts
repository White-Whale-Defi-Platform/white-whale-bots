import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import {
	Asset,
	isJunoSwapNativeAssetInfo,
	isNativeAsset,
	isWyndDaoNativeAsset,
	isWyndDaoTokenAsset,
	JunoSwapAssetInfo,
} from "../../../core/types/base/asset";
import { AmmDexName, Pool } from "../../../core/types/base/pool";
import { Uint128 } from "../../../core/types/base/uint128";
import { getPoolFees } from "./getPoolFees";
import { getPoolsFromFactory } from "./getPoolsFromFactory";

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

/**
 * Retrieves the pool state of a given Terra address.
 * @param client The cosmwasm client to send requests from, including wasmextension.
 * @param pools An array of Pool objects to obtain the chain states for.
 */
export async function getPoolStates(chainOperator: ChainOperator, pools: Array<Pool>) {
	await Promise.all(
		pools.map(async (pool) => {
			if (pool.dexname === AmmDexName.junoswap) {
				const poolState = <JunoSwapPoolState>await chainOperator.queryContractSmart(pool.address, { info: {} });

				pool.assets[0].amount = poolState.token1_reserve;
				pool.assets[1].amount = poolState.token2_reserve;
				return;
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
): Promise<Array<Pool>> {
	const pools: Array<Pool> = [];
	const factoryPools = await getPoolsFromFactory(chainOperator, factoryMapping);
	const allKnownPools = factoryPools.map((fp) => fp.pool);
	allKnownPools.push(...poolAddresses.map((pa) => pa.pool));
	const uniquePools = new Set(allKnownPools);

	for (const poolAddress of uniquePools) {
		console.log("processing: ", poolAddress);
		let assets: Array<Asset> = [];
		let dexname: AmmDexName;
		let totalShare: string;

		try {
			const poolPair = await chainOperator.queryContractSmart(poolAddress, { pair: {} });
			if (
				poolPair.pair_type["stable" as keyof typeof poolPair.pair_type] ||
				poolPair.pair_type["lsd" as keyof typeof poolPair.pair_type]
			) {
				console.log("---------stable pool, skipping for now--------");
				continue;
			}
		} catch (error) {
			console.log("cannot find stable/lsd pooltype for ", poolAddress, " assuming no stable pool");
		}
		try {
			const poolState = <PoolState>await chainOperator.queryContractSmart(poolAddress, { pool: {} });
			[assets, dexname, totalShare] = processPoolStateAssets(poolState);
		} catch (error) {
			try {
				const poolState = <JunoSwapPoolState>await chainOperator.queryContractSmart(poolAddress, { info: {} });
				[assets, dexname, totalShare] = processJunoswapPoolStateAssets(poolState);
			} catch (error) {
				console.log("cannot identify pool");
				console.log(error);
				continue;
			}
		}
		const factory = factoryPools.find((fp) => fp.pool == poolAddress)?.factory ?? "";
		const router = factoryPools.find((fp) => fp.pool == poolAddress)?.router ?? "";

		let inputfee, outputfee, lpratio;
		const manuallyProvidedPool = poolAddresses.find((pa) => pa.pool === poolAddress);
		if (manuallyProvidedPool) {
			console.log("manually entered fees for ", poolAddress);
			//we provided pool info manually, overwrite queried results
			(inputfee = manuallyProvidedPool.inputfee),
				(outputfee = manuallyProvidedPool.outputfee),
				(lpratio = manuallyProvidedPool.LPratio);
		} else {
			console.log("querying fees for ", poolAddress);
			[inputfee, outputfee, lpratio] = await getPoolFees(chainOperator, poolAddress, dexname, factory);
		}

		pools.push({
			assets: assets,
			totalShare: totalShare,
			address: poolAddress,
			dexname: dexname,
			inputfee: inputfee,
			outputfee: outputfee,
			LPratio: lpratio,
			factoryAddress: factory,
			routerAddress: router,
		});
	}
	return pools;
}

/**
 *
 */
function processPoolStateAssets(poolState: PoolState): [Array<Asset>, AmmDexName, string] {
	const assets: Array<Asset> = [];
	let type = AmmDexName.default;

	for (const assetState of poolState.assets) {
		if (isWyndDaoNativeAsset(assetState.info)) {
			assets.push({
				amount: assetState.amount,
				info: { native_token: { denom: assetState.info.native } },
			});
			type = AmmDexName.wyndex;
		} else if (isWyndDaoTokenAsset(assetState.info)) {
			assets.push({
				amount: assetState.amount,
				info: { token: { contract_addr: assetState.info.token } },
			});
			type = AmmDexName.wyndex;
		} else {
			if (isNativeAsset(assetState.info)) {
				if (assetState.info.native_token.denom === "inj") {
					assets.push({
						amount: String(+assetState.amount / 1e12),
						info: assetState.info,
					});
				} else {
					assets.push(assetState);
				}
			} else {
				assets.push(assetState);
			}
		}
	}
	return [assets, type, poolState.total_share];
}

/**
 *
 */
function processJunoswapPoolStateAssets(poolState: JunoSwapPoolState): [Array<Asset>, AmmDexName, string] {
	const assets: Array<Asset> = [];
	assets.push({
		amount: String(poolState.token1_reserve),
		info: isJunoSwapNativeAssetInfo(poolState.token1_denom)
			? { native_token: { denom: poolState.token1_denom.native } }
			: { token: { contract_addr: poolState.token1_denom.cw20 } },
	});

	assets.push({
		amount: String(poolState.token2_reserve),
		info: isJunoSwapNativeAssetInfo(poolState.token2_denom)
			? { native_token: { denom: poolState.token2_denom.native } }
			: { token: { contract_addr: poolState.token2_denom.cw20 } },
	});

	return [assets, AmmDexName.junoswap, poolState.lp_token_supply];
}
