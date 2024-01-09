import { StdFee } from "@cosmjs/stargate";

import { getPaths, newGraph } from "../../arbitrage/graph";
import { identity } from "../identity";
import { isMatchingAssetInfos } from "./asset";
import { DexConfig } from "./configs";
import { Orderbook } from "./orderbook";
import { Pool } from "./pool";
export interface Path {
	pools: Array<Pool>;
	equalpaths: Array<Path>;
	identifier: string;
	fee: StdFee;
	threshold: number;
}

export enum OrderSequence {
	AmmFirst,
	OrderbookFirst,
}

export interface OrderbookPath {
	pool: Pool;
	orderbook: Orderbook;
	orderSequence: OrderSequence;
	equalpaths: Array<OrderbookPath>;
	identifier: string;
	fee: StdFee;
	threshold: number;
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
export function getOrderbookAmmPaths(
	pools: Array<Pool>,
	orderbooks: Array<Orderbook>,
	botConfig: DexConfig,
): Array<OrderbookPath> {
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
				const { fee, threshold } = getFeeAndThresholdForOrderbookPath(pool, orderbook, botConfig);
				const path = identity<OrderbookPath>({
					pool: pool,
					orderbook: orderbook,
					orderSequence: OrderSequence.AmmFirst,
					equalpaths: [],
					identifier: pool.address + orderbook.marketId,
					fee: fee,
					threshold: threshold,
				});
				const reversedpath = identity<OrderbookPath>({
					pool: pool,
					orderbook: orderbook,
					orderSequence: OrderSequence.OrderbookFirst,
					equalpaths: [],
					identifier: orderbook.marketId + pool.address,
					fee: fee,
					threshold: threshold,
				});
				paths.push(path, reversedpath);
				idx += 2;
			}
		}
	}
	return paths;
}

/**
 *
 */
export function getAmmPaths(pools: Array<Pool>, botConfig: DexConfig) {
	const graph = newGraph(pools);
	return getPaths(graph, botConfig) ?? [];
}

/**
 *
 */
export function getFeeAndThresholdForAmmPath(
	pathPools: Array<Pool>,
	botConfig: DexConfig,
): { fee: StdFee; threshold: number } {
	const decimalCompensator = botConfig.gasDenom === "inj" ? 1e12 : 1;
	const flashloanCompensator = botConfig.flashloanRouterAddress ? 5 : 1;
	const gasFee = {
		denom: botConfig.gasDenom,
		amount: (
			botConfig.gasPerHop *
			pathPools.length *
			botConfig.gasPrice *
			decimalCompensator *
			flashloanCompensator
		).toFixed(),
	};
	//threshold has to be set threshold + paid fees for specific path in BASE_DENOM
	const threshold =
		botConfig.profitThreshold +
		botConfig.gasPerHop *
			pathPools.length *
			botConfig.gasPrice *
			flashloanCompensator *
			botConfig.gasDenomToBaseRato;
	return {
		fee: { amount: [gasFee], gas: String(botConfig.gasPerHop * pathPools.length * flashloanCompensator) },
		threshold: threshold,
	}; //in 6 decimals
}

/**
 *
 */
export function getFeeAndThresholdForOrderbookPath(
	pool: Pool,
	orderbook: Orderbook,
	botConfig: DexConfig,
): { fee: StdFee; threshold: number } {
	const decimalCompensator = botConfig.gasDenom === "inj" ? 1e12 : 1;
	const flashloanCompensator = botConfig.flashloanRouterAddress ? 6 : 1;
	const gasFee = {
		denom: botConfig.gasDenom,
		amount: (botConfig.gasPerHop * 2 * botConfig.gasPrice * decimalCompensator * flashloanCompensator).toFixed(),
	};
	//threshold has to be set threshold + paid fees for specific path in BASE_DENOM

	const threshold =
		botConfig.profitThreshold +
		botConfig.gasPerHop * 2 * botConfig.gasPrice * flashloanCompensator * botConfig.gasDenomToBaseRato;

	return {
		fee: { amount: [gasFee], gas: String(botConfig.gasPerHop * 2 * flashloanCompensator) },
		threshold: threshold,
	}; //in 6 decimals
}
