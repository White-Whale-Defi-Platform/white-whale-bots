import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { AssetInfo } from "../../../core/types/base/asset";

interface FactoryStatePair {
	asset_infos: Array<AssetInfo>;
	contract_addr: string;
	liquidity_token: string;
}
interface FactoryState {
	pairs: Array<FactoryStatePair>;
}

/**
 *
 */
export async function getPoolsFromFactory(
	chainOperator: ChainOperator,
	factoryMapping: Array<{ factory: string; router: string }>,
): Promise<Array<{ pool: string; factory: string; router: string }>> {
	const factorypairs: Array<{ pool: string; factory: string; router: string }> = [];
	await Promise.all(
		factoryMapping.map(async (factorymap) => {
			let res: FactoryState = await chainOperator.queryContractSmart(factorymap.factory, {
				pairs: { limit: 30 },
			});

			res.pairs.map((factorypair) => {
				factorypairs.push({
					pool: factorypair.contract_addr,
					factory: factorymap.factory,
					router: factorymap.router,
				});
			});

			while (res.pairs.length == 30) {
				const start_after = res.pairs[res.pairs.length - 1].asset_infos;
				res = await chainOperator.queryContractSmart(factorymap.factory, {
					pairs: { limit: 30, start_after: start_after },
				});

				res.pairs.map((factorypair) => {
					factorypairs.push({
						pool: factorypair.contract_addr,
						factory: factorymap.factory,
						router: factorymap.router,
					});
				});
			}
		}),
	);

	return factorypairs;
}
