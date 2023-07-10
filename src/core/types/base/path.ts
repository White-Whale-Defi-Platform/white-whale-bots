import { identity } from "../identity";
import { isMatchingAssetInfos } from "./asset";
import { Orderbook } from "./orderbook";
import { Pool } from "./pool";

export interface Path {
	pools: Array<Pool>;
	equalpaths: Array<[string, number]>;
	identifier: [string, number];
}

export interface OrderbookPath {
	pools: [Orderbook, Pool] | [Pool, Orderbook];
	equalpaths: Array<[string, number]>;
	identifier: [string, number];
}

/**
 *
 */
export function getOrderbookAmmPaths(pools: Array<Pool>, orderbooks: Array<Orderbook>): Array<OrderbookPath> {
	const paths: Array<OrderbookPath> = [];
	let idx = 0;
	for (const orderbook of orderbooks) {
		for (const pool of pools) {
			if (
				(isMatchingAssetInfos(pool.assets[0].info, orderbook.baseAssetInfo) &&
					isMatchingAssetInfos(pool.assets[1].info, orderbook.quoteAssetInfo)) ||
				(isMatchingAssetInfos(pool.assets[1].info, orderbook.baseAssetInfo) &&
					isMatchingAssetInfos(pool.assets[0].info, orderbook.quoteAssetInfo))
			) {
				const path = identity<OrderbookPath>({
					pools: [pool, orderbook],
					equalpaths: [],
					identifier: [pool.LPratio + orderbook.marketId, idx],
				});
				const reversedpath = identity<OrderbookPath>({
					pools: [orderbook, pool],
					equalpaths: [],
					identifier: [orderbook.marketId + pool.LPratio, idx + 1],
				});
				paths.push(path, reversedpath);
				idx += 2;
			}
		}
	}
	return paths;
}
