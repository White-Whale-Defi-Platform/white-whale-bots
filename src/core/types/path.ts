import { identity } from "../identity";
import { isMatchingAssetInfos, isNativeAsset, NativeAssetInfo } from "./asset";
import { Pool, routeBetweenPools } from "./pool";

export interface Path {
	pools: Array<Pool>;
}

/**
 * Creates a list of possible 2-hop paths given a list of pools.
 * @param pools The pools to create paths from.
 * @returns All the paths that exist.
 */
export function getPathsFromPool(pools: Array<Pool>, offerAsset: NativeAssetInfo): Array<Path> {
	return pools.flatMap((a) => {
		return (
			pools
				// filter out same pools
				.filter((b) => a !== b)
				// filter pools with same asset infos
				.filter((b) => {
					const matchingAssets = a.assets.filter(
						(assetA) =>
							b.assets.find((assetB) => isMatchingAssetInfos(assetA.info, assetB.info)) !== undefined,
					);
					return matchingAssets.length === a.assets.length;
				})
				.filter(
					(a) =>
						isMatchingAssetInfos(a.assets[0].info, offerAsset) ||
						isMatchingAssetInfos(a.assets[1].info, offerAsset),
				)
				.map((b) => {
					return identity<Path>({
						pools: [a, b],
					});
				})
		);
	});
}

/**
 *
 */
export function getPathsFromPools3Hop(pools: Array<Pool>, offerAsset: NativeAssetInfo): Array<Path> {
	const viablePaths: Array<Path> = [];
	const all3HopPaths: Array<Array<Pool>> = [];
	pools.map((a) => {
		pools.map((b) => {
			if (a.address != b.address) {
				pools.map((c) => {
					if (a.address != c.address && b.address != c.address) {
						all3HopPaths.push([a, b, c]);
					}
				});
			}
		});
	});
	for (const potentialPath of all3HopPaths) {
		if (
			routeBetweenPools(potentialPath[0], potentialPath[1]) &&
			routeBetweenPools(potentialPath[1], potentialPath[2]) &&
			routeBetweenPools(potentialPath[0], potentialPath[2])
		) {
			const path: Path = { pools: potentialPath };
			if (viable3HopPath(path, offerAsset)) {
				viablePaths.push(path);
			}
		}
	}
	return viablePaths;
}

/**
 *
 */
function viable3HopPath(path: Path, offerAsset: NativeAssetInfo): boolean {
	if (
		(isMatchingAssetInfos(path.pools[0].assets[0].info, offerAsset) ||
			isMatchingAssetInfos(path.pools[0].assets[1].info, offerAsset)) &&
		!isMatchingAssetInfos(path.pools[1].assets[0].info, offerAsset) &&
		!isMatchingAssetInfos(path.pools[1].assets[1].info, offerAsset) &&
		(isMatchingAssetInfos(path.pools[2].assets[0].info, offerAsset) ||
			isMatchingAssetInfos(path.pools[2].assets[1].info, offerAsset))
	) {
		const assetInfos = path.pools.flatMap((pool) => {
			return pool.assets.map((asset) => {
				return isNativeAsset(asset.info) ? asset.info.native_token.denom : asset.info.token.contract_addr;
			});
		});
		const uniqueSet = [...new Set(assetInfos)];
		return uniqueSet.length == 3;
	} else return false;
}
