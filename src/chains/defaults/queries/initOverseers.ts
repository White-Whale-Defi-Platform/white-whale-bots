import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { AnchorOverseer, AnchorWhitelist, setBorrowLimits } from "../../../core/types/base/overseer";
import { setLoans } from "./getLoans";

/**
 *
 */
export async function initLiquidationOverseers(
	overseerAddresses: string | Array<string>,
	chainOperator: ChainOperator,
) {
	// export async function getliqudationinfos(overseer: Array<string>, operator: ChainOperator): Promise<Liquidate> {
	let overseerAddresssArray: Array<string>;
	if (typeof overseerAddresses === "string") {
		overseerAddresssArray = [overseerAddresses];
	} else {
		overseerAddresssArray = overseerAddresses;
	}

	const overseers: Array<AnchorOverseer> = [];
	for (const overseerAddress of overseerAddresssArray) {
		const overseer: AnchorOverseer | undefined = await initLiquidationOverseer(overseerAddress, chainOperator);
		if (!overseer) {
			console.log("Overseer cannot be found: ", overseerAddress);
			process.exit(1);
		}
		overseer.priceFeed = await initPriceFeeds(overseer, chainOperator);
		await setLoans(overseer, chainOperator);
		setBorrowLimits(overseer);
		overseers.push(overseer);
	}
	return overseers;
}

/**
 *
 */
async function initLiquidationOverseer(
	overseer: string,
	chainOperator: ChainOperator,
): Promise<AnchorOverseer | undefined> {
	const overseerConfig: AnchorOverseerConfig = await chainOperator.queryContractSmart(overseer, {
		config: { limit: 100 },
	});
	await delay(500);
	if (overseerConfig) {
		const whitelist: AnchorWhitelist = await chainOperator.queryContractSmart(overseer, {
			whitelist: { limit: 100 },
		});
		await delay(200);
		const priceFeeders: Set<string> = new Set();

		for (const whitelisted of whitelist.elems) {
			const feeder: AnchorAssetFeeder = await chainOperator.queryContractSmart(overseerConfig.oracle_contract, {
				feeder: { asset: whitelisted.collateral_token },
			});
			await delay(200);
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
			loans: {},
			stableDenom: overseerConfig.stable_denom,
		};
		return anchorOverseer;
	}
	console.log("cannot find overseer config for: ", overseer);
	return undefined;
}
/**
 *
 */
async function initPriceFeeds(overseer: AnchorOverseer, chainOperator: ChainOperator) {
	const priceFeed: (typeof overseer)["priceFeed"] = new Map();
	const priceFeedRes: PriceFeedResult = await chainOperator.queryContractSmart(overseer.oracleAddress, {
		prices: { limit: 1000 },
	});
	for (const price of priceFeedRes.prices) {
		priceFeed.set(price.asset, +price.price);
	}
	return priceFeed;
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
	prices: Array<{
		asset: string;
		price: string;
		last_updated_time: 1686224223;
	}>;
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
