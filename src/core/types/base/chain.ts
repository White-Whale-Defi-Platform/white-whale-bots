import { MsgTransfer } from "cosmjs-types/ibc/applications/transfer/v1/tx";

import * as chainImports from "../../../chains";
import { getPoolStates, initPools } from "../../../chains/defaults";
import { ChainOperator } from "../../chainOperator/chainoperator";
import { ChainAssetList, getChainAssetList, IbcAssetEntry } from "../../ibc/chainAssets";
import { Logger } from "../../logging";
import { DexLoopInterface } from "../arbitrageloops/interfaces/dexloopInterface";
import { isNativeAsset } from "./asset";
import { ChainConfig } from "./configs";
import { LogType } from "./logging";
import { Orderbook } from "./orderbook";
import { Pool } from "./pool";

export interface Chain {
	chainConfig: ChainConfig;
	pools: Array<Pool>;
	chainOperator: ChainOperator;
	orderbooks: Array<Orderbook>;
	IBCAssets: Map<string, IbcAssetEntry>;
	IBCTransferMessages: Map<string, Array<MsgTransfer>>;
	updatePoolStates: DexLoopInterface["updatePoolStates"];
	updateOrderbookStates?: DexLoopInterface["updateOrderbookStates"];
}

/**
 *
 */
export async function initChain(chainConfig: ChainConfig, logger: Logger): Promise<Chain> {
	const initOrderbook = chainImports.injective.initOrderbooks;
	const chain = await import("../../../chains/" + chainConfig.chainPrefix).then(async (chainSetups) => {
		if (chainSetups === undefined) {
			await logger.sendMessage("Unable to resolve specific chain imports, using defaults", LogType.Console);
		}
		// msgFactory = chainSetups.getFlashArbMessages;
		const getPoolStatesChain: typeof getPoolStates = chainSetups.getPoolStates;
		const initPoolsChain: typeof initPools = chainSetups.initPools;
		const getOrderbookState = chainImports.injective.getOrderbookState; //default injective

		const chainOperator = await ChainOperator.connectWithSigner(chainConfig);
		const nativeTokenPoolsChain = await initPoolsChain(
			chainOperator,
			chainConfig.poolEnvs,
			chainConfig.mappingFactoryRouter,
			false,
		);

		const ibcStartingAssets: Map<string, IbcAssetEntry> = new Map();
		const chainAssetListFull: ChainAssetList = await getChainAssetList(chainOperator.client.chainId);
		nativeTokenPoolsChain.forEach((pool) => {
			const assetIbcInfo0 = chainAssetListFull.chain_to_assets_map[chainOperator.client.chainId].assets.find(
				(asset) =>
					asset.denom === (isNativeAsset(pool.assets[0].info) ? pool.assets[0].info.native_token.denom : ""),
			);
			const assetIbcInfo1 = chainAssetListFull.chain_to_assets_map[chainOperator.client.chainId].assets.find(
				(asset) =>
					asset.denom === (isNativeAsset(pool.assets[1].info) ? pool.assets[1].info.native_token.denom : ""),
			);
			if (assetIbcInfo0) {
				ibcStartingAssets.set(`${assetIbcInfo0.origin_chain_id}/${assetIbcInfo0.origin_denom}`, assetIbcInfo0);
			}
			if (assetIbcInfo1) {
				ibcStartingAssets.set(`${assetIbcInfo1.origin_chain_id}/${assetIbcInfo1.origin_denom}`, assetIbcInfo1);
			}
			if (assetIbcInfo0 && assetIbcInfo1) {
				pool.ibcAssets = [assetIbcInfo0, assetIbcInfo1];
			} else {
				// console.log("removing: ", pool.address, pool.assets[0].info, pool.assets[1].info);
				// nativeTokenPoolsChain = nativeTokenPoolsChain.filter(
				// 	(poolToKeep) => poolToKeep.address !== pool.address,
				// );
			}
		});
		const orderbooks: Array<Orderbook> = [];
		if (chainConfig.chainPrefix === "inj" && chainConfig.orderbooks.length > 0) {
			const obs = await initOrderbook(chainOperator, chainConfig);
			if (obs) {
				orderbooks.push(...obs);
			}
		}

		return {
			chainConfig: chainConfig,
			pools: nativeTokenPoolsChain,
			chainOperator: chainOperator,
			orderbooks: orderbooks,
			IBCAssets: ibcStartingAssets,
			IBCTransferMessages: new Map(),
			updatePoolStates: getPoolStatesChain,
			updateOrderbookStates: getOrderbookState,
		};
	});
	return chain;
}
