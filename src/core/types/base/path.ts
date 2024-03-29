import { identity } from "../identity";
import { isMatchingAssetInfos } from "./asset";
import { Orderbook } from "./orderbook";
import { Pool } from "./pool";

export interface Path {
	pools: Array<Pool>;
	equalpaths: Array<[string, number]>;
	identifier: [string, number];
}

export enum OrderSequence {
	AmmFirst,
	OrderbookFirst,
}

export interface OrderbookPath {
	pool: Pool;
	orderbook: Orderbook;
	orderSequence: OrderSequence;
	equalpaths: Array<[string, number]>;
	identifier: [string, number];
}
/**
 *
 */
export function isOrderbookPath(x: any): x is OrderbookPath {
	return x["orderbook" as keyof typeof x] !== undefined;
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
					pool: pool,
					orderbook: orderbook,
					orderSequence: OrderSequence.AmmFirst,
					equalpaths: [],
					identifier: [pool.LPratio + orderbook.marketId, idx],
				});
				const reversedpath = identity<OrderbookPath>({
					pool: pool,
					orderbook: orderbook,
					orderSequence: OrderSequence.OrderbookFirst,
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
