import * as osmosis from "osmojs";
import { Query as OsmosisQueryClient } from "osmojs/dist/codegen/osmosis/poolmanager/v1beta1/query.rpc.Query";

import { BotConfig } from "../../types/base/configs";
import CosmjsAdapter from "./cosmjs";

/**
 *
 */
class OsmosisAdapter extends CosmjsAdapter {
	private _poolmanagerQueryClient!: OsmosisQueryClient;

	/**
	 *
	 */
	constructor(botConfig: BotConfig) {
		super(botConfig);
	}

	/**
	 *
	 */
	async init(botConfig: BotConfig) {
		await super.init(botConfig);
		this._poolmanagerQueryClient = osmosis.osmosis.poolmanager.v1beta1.createRpcQueryExtension(
			this._wasmQueryClient,
		);
	}
	/**
	 *
	 */
	async allPools() {
		return await this._poolmanagerQueryClient.allPools();
	}

	/**
	 *
	 */
	async poolState(id: number) {
		return await this._poolmanagerQueryClient.pool({ poolId: BigInt(id) });
	}
}

export default OsmosisAdapter;
