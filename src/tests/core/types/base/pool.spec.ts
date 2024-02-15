import BigNumber from "bignumber.js";
import { assert, expect } from "chai";
import dotenv from "dotenv";
import { describe } from "mocha";

import { initPools } from "../../../../chains/defaults/queries/getPoolState";
import { ChainOperator } from "../../../../core/chainOperator/chainoperator";
import { Asset, fromChainAsset, RichAsset, toChainAsset } from "../../../../core/types/base/asset";
import { DexConfig, setBotConfig } from "../../../../core/types/base/configs";
import { AmmDexName, outGivenIn, PairType, Pool } from "../../../../core/types/base/pool";
import { identity } from "../../../../core/types/identity";

dotenv.config({ path: "./src/envs/chains/injective.env" });
describe("Test outGivenIn", () => {
	const pool = identity<Pool>({
		assets: [
			{
				info: {
					native_token: {
						denom: "inj",
					},
				},
				amount: "144264731967.836615185675",
				decimals: 18,
			},
			{
				info: {
					native_token: {
						denom: "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7",
					},
				},
				amount: "946834545199",
				decimals: 6,
			},
		],
		totalShare: "357638203545997474",
		dexname: AmmDexName.default,
		pairType: PairType.xyk,
		address: "",
		factoryAddress: "",
		routerAddress: "",
		inputfee: 0,
		outputfee: 0.3,
		LPratio: 0.6667,
	});
	it("Should return positive number for given swap", async () => {
		const input: Asset = {
			amount: "27244227",
			info: {
				native_token: {
					denom: "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7",
				},
			},
		};

		const output = outGivenIn(pool, input);
		assert.isAbove(+output.amount, 0);
	});
	it("Should return 4138502584293659410 within 1000 margin for given input swap 27244227peggy0xdAC17F958D2ee523a2206206994597C13D831ec7", async () => {
		const input: Asset = {
			amount: "27244227",
			info: {
				native_token: {
					denom: "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7",
				},
			},
		};

		const output = outGivenIn(pool, input);
		assert.closeTo(+output.amount * 1e12, BigNumber("4138502584293659410").toNumber(), 1000);
	});
	it("Should return positive number for given swap", async () => {
		const pool = identity<Pool>({
			assets: [
				{
					info: {
						native_token: {
							denom: "uwhale",
						},
					},
					amount: "1442647319670",
					decimals: 6,
				},
				{
					info: {
						native_token: {
							denom: "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7",
						},
					},
					amount: "946834545199",
					decimals: 6,
				},
			],
			totalShare: "357638203545997474",
			dexname: AmmDexName.default,
			pairType: PairType.xyk,
			address: "",
			factoryAddress: "",
			routerAddress: "",
			inputfee: 0,
			outputfee: 0.3,
			LPratio: 0.6667,
		});

		const input: Asset = {
			amount: "1000000",
			info: {
				native_token: {
					denom: "uwhale",
				},
			},
		};

		const output = outGivenIn(pool, input);
		assert.isAbove(+output.amount, 0);
	});
	it("Should return tokens nearly equal to the price of uwhale in the pool for swapping 1whale", async () => {
		const pool = identity<Pool>({
			assets: [
				{
					info: {
						native_token: {
							denom: "uwhale",
						},
					},
					amount: "1442647319670",
					decimals: 6,
				},
				{
					info: {
						native_token: {
							denom: "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7",
						},
					},
					amount: "946834545199",
					decimals: 6,
				},
			],
			totalShare: "357638203545997474",
			dexname: AmmDexName.default,
			pairType: PairType.xyk,
			address: "inj1c95v0zr7ah777qn05sqwfnd03le4f40rucs0dp",
			factoryAddress: "",
			routerAddress: "",
			inputfee: 0,
			outputfee: 0.3,
			LPratio: 0.6667,
		});
		const input: Asset = {
			amount: "1000000",
			info: {
				native_token: {
					denom: "uwhale",
				},
			},
		};

		const output = outGivenIn(pool, input);
		const price = BigNumber(pool.assets[1].amount).dividedBy(BigNumber(pool.assets[0].amount));
		assert.closeTo(price.toNumber() * 0.997 * +input.amount, +output.amount, 100);
	});
});

describe("Test PCL Pool interactions", () => {
	it("should be able to calculate outgivenin for PCL pools", async () => {
		// load config required for querying
		dotenv.config({ path: "./src/tests/mock/envs/injective.env" });
		const botConfig = <DexConfig>await setBotConfig(process.env);
		// console.log(botConfig);
		const chainOperator = await ChainOperator.connectWithSigner(botConfig);
		const pools = await initPools(chainOperator, botConfig.poolEnvs, []);
		const pclPool = pools.find((pool) => pool.pairType === PairType.pcl);

		expect(botConfig, "botconfig empty").to.not.be.undefined;
		expect(chainOperator, "chainoperator issue").to.not.be.undefined;
		expect(pclPool, "PCL pool not found").to.not.be.undefined;
		if (!pclPool) {
			return;
		}

		for (const poolAsset of pclPool.assets) {
			const offerAsset: RichAsset = {
				info: poolAsset.info,
				decimals: poolAsset.decimals,
				amount: "10000000",
			};

			const out0 = outGivenIn(pclPool, offerAsset);
			const chainAsset: Asset = toChainAsset(offerAsset);
			const simulatedResult = await chainOperator.queryContractSmart(pclPool.address, {
				simulation: { offer_asset: chainAsset },
			});
			const outSimulatedAsset = fromChainAsset({ amount: simulatedResult.return_amount, info: out0.info });
			assert.closeTo(+out0.amount, +outSimulatedAsset.amount, 1);
		}
	});
});

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
