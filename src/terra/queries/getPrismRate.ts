import { CosmWasmClient } from "@cosmjs/cosmwasm-stargate";

interface PrismState {
	data: {
		exchange_rate: string;
		total_bond_amount: string;
		last_index_modification: number;
		principle_balance_before_exchange_update: string;
		prev_hub_balance: string;
		actual_unbonded_amount: string;
		last_unbonded_time: number;
		last_processed_batch: number;
	};
}

/**
 * Retrieves the pool state of a given Terra address.
 * @param client The cosmwasm client to send requests from.
 * @param address The Terra address to retrieve the pool state from.
 */
export async function getPrismRate(client: CosmWasmClient, contract: string): Promise<number> {
	const prismState: PrismState = await client.queryContractSmart(contract, { state: {} });
	return +prismState.data.exchange_rate;
}
