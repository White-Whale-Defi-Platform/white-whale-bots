import axios from "axios";

export interface ChainAssetList {
	chain_to_assets_map: Record<string, { assets: Array<IbcAssetEntry> }>;
}

export type IbcAssetEntry = {
	denom: string;
	chain_id: string;
	origin_denom: string;
	origin_chain_id: string;
	trace: string;
	symbol: string;
	name: string;
	logo_uri: string;
	decimals: number;
};

/**
 *
 */
export async function getChainAssetList(chainId: string): Promise<ChainAssetList> {
	const chainAssetsResults = await axios.get(`https://api.skip.money/v1/fungible/assets?chain_id=${chainId}`);

	return chainAssetsResults.data;
}
