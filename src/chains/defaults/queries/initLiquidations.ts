import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { AnchorOverseer, AnchorWhitelist, Overseer } from "../../../core/types/base/overseer";
import { getLoans } from "./getLoans";

/**
 *
 */
export async function initLiquidationOverseers(overseers: string | Array<string>, chainOperator: ChainOperator) {
	// export async function getliqudationinfos(overseer: Array<string>, operator: ChainOperator): Promise<Liquidate> {
	let overseerAddresssArray: Array<string>;
	if (typeof overseers === "string") {
		overseerAddresssArray = [overseers];
	} else {
		overseerAddresssArray = overseers;
	}

	for (const overseerAddress of overseerAddresssArray) {
			const overseer: AnchorOverseer | undefined = await initLiquidationOverseer(overseerAddress, chainOperator);
			if(!overseer){
                console.log("Overseer cannot be found: ", overseerAddress);
                process.exit(1);
            }
            overseer.priceFeed = await initPriceFeeds(overseer, chainOperator);
			
			const loans = await getLoans(
				overseer,
				chainOperator,
				overseer.marketAddress,
				overseer.priceFeed,
			);
			outLoan[overseer[x]] = tmpOutLoan[overseer[x]];
			outConfig[overseer[x]] = outCfgtmp[0][overseer[x]];

			outCfgtmp[1].forEach((elem: string) => {
				outFeeder[elem] = { overseer: overseer[x] };
			});
			outMMarkets[outConfig[overseer[x]].marketContract!] = { overseer: overseer[x] };
		}
	}
	await delay(1000);
	const out: Liquidate = {
		configs: outConfig,
		loans: outLoan,
		prices: outPrices,
		feeder: outFeeder,
		moneymarkets: outMMarkets,
	};
	return out;
}

/**
 *
 */
async function initLiquidationOverseer(overseer: string, chainOperator: ChainOperator): Promise<AnchorOverseer | undefined> {
	const overseerConfig: AnchorOverseerConfig = await chainOperator.queryContractSmart(overseer, {
		config: { limit: 100 },
	});
	await delay(5000);
	if (overseerConfig) {
		const whitelist: AnchorWhitelist = await chainOperator.queryContractSmart(overseer, {
			whitelist: { limit: 100 },
		});
		await delay(2000);
		const priceFeeders: Set<string> = new Set();

		for (const whitelisted of whitelist.elems) {
			const feeder: AnchorAssetFeeder = await chainOperator.queryContractSmart(overseerConfig.oracle_contract, {
				feeder: { asset: whitelisted.collateral_token },
			});
			await delay(2000);
			priceFeeders.add(feeder.feeder);
		}
		const anchorOverseer: AnchorOverseer = {
			overseerAddress: overseer,
			oracleAddress: overseerConfig.oracle_contract,
			marketAddress: overseerConfig.market_contract,
			liquidatorAddress: overseerConfig.liquidation_contract,
			priceFeeders: Array.from(priceFeeders),
            priceFeed: new Map(),
            whitelist: whitelist,
		};
		return anchorOverseer;
	}
	console.log("cannot find overseer config for: ", overseer);
	return undefined;
}
async function initPriceFeeds(overseer: AnchorOverseer, chainOperator: ChainOperator){
    let priceFeed: typeof overseer['priceFeed'] = new Map();
    const priceFeedRes: PriceFeedResult = await chainOperator.queryContractSmart( overseer.oracleAddress, {prices: { limit: 1000}});
    for(const price of priceFeedRes.prices){
        priceFeed.set(price.asset, +price.price);
    }
    return priceFeed
}
interface AnchorOverseerConfig {
	owner_addr: string;
	oracle_contract: string;
	market_contract: string;
	liquidation_contract: string;
	borrow_reserves_bucket_contract: string;
	threshold_deposit_rate: string;
	target_deposit_rate: string;
	buffer_distribution_factor: string;
	stable_denom: string;
	epoch_period: number;
	price_timeframe: number;
	dyn_rate_epoch: number;
	dyn_rate_maxchange: string;
	dyn_rate_yr_increase_expectation: string;
	dyn_rate_min: string;
	dyn_rate_max: string;
}

interface PriceFeedResult { 
    prices: Array<
        {
          asset: string,
          price: string,
          last_updated_time: 1686224223
        }>
}

interface AnchorAssetFeeder {
	asset: string;
	feeder: string;
}
/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
