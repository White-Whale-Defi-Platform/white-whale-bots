import axios, { AxiosRequestConfig } from "axios";

import { ChainOperator } from "../chainOperator/chainoperator";
import { Chain } from "../types/base/chain";

/**
 *
 */
export async function getChainTransfer(sourceChain: Chain, destinationChain: Chain) {
	sourceChain.chainAssets.forEach(async (sourceEntry, key) => {
		const destinationEntry = destinationChain.chainAssets.get(key);
		if (destinationEntry) {
			const payload = getQueryPayload(
				sourceChain.chainOperator,
				destinationChain.chainOperator,
				sourceEntry.denom,
				destinationEntry.denom,
			);
			const axiosConfig: AxiosRequestConfig = {
				headers: {
					accept: "application/json",
					"content-type": "application/json",
				},
			};
			const res = await axios.post("https://api.skip.money/v1/fungible/msgs_direct", payload, axiosConfig);
			console.log(res.data);
		}
	});
}

/**
 *
 */
function getQueryPayload(
	sourceOperator: ChainOperator,
	destOperator: ChainOperator,
	sourceDenom: string,
	destDenom: string,
) {
	return {
		chain_ids_to_addresses: {
			[sourceOperator.client.chainId]: sourceOperator.client.publicAddress,
			[destOperator.client.chainId]: destOperator.client.publicAddress,
			"axelar-dojo-1": "axelar1suhw4myyt4mhcw5270vddqh62ckemp60mg8vkq",
			"cosmoshub-4": "cosmos1suhw4myyt4mhcw5270vddqh62ckemp60lx3yap",
		},
		source_asset_denom: sourceDenom,
		source_asset_chain_id: sourceOperator.client.chainId,
		dest_asset_denom: destDenom,
		dest_asset_chain_id: destOperator.client.chainId,
		amount_in: "1000000",
		amount_out: "1000000",
	};
}
/*
    for(const asset of sourceChain.chainAssets){

    }
}
curl --request POST \
     --url https://api.skip.money/v1/fungible/msgs_direct \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data 
const payload =
*/
