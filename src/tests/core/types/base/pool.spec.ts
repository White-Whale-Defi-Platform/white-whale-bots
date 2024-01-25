import { setupWasmExtension } from "@cosmjs/cosmwasm-stargate";
import { fromAscii, fromBase64 } from "@cosmjs/encoding";
import { QueryClient } from "@cosmjs/stargate";
import { HttpBatchClient, Tendermint34Client } from "@cosmjs/tendermint-rpc";
import BigNumber from "bignumber.js";
import { assert } from "chai";
import { describe } from "mocha";

import { processPoolStateAssets } from "../../../../chains/defaults/queries/getPoolState";
import { Asset, fromChainAsset } from "../../../../core/types/base/asset";
import { AmmDexName, outGivenIn, PairType, PCLPool, Pool } from "../../../../core/types/base/pool";
import { Uint128 } from "../../../../core/types/base/uint128";
import { identity } from "../../../../core/types/identity";

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
	it("should have a return amount close to simulated result for PCL pool", async () => {
		//creat config based on environment variables
		const _httpClient = new HttpBatchClient("https://ww-injective-rpc.polkachu.com");
		const tmClient = await Tendermint34Client.create(_httpClient);
		const _wasmQueryClient = QueryClient.withExtensions(tmClient, setupWasmExtension);

		interface PoolState {
			assets: [Asset, Asset];
			total_share: Uint128;
		}
		interface PCLConfigResponse {
			block_time_last: number;
			params: string;
			owner: string;
			factory_addr: string;
			price_scale: string;
		}

		interface PCLConfigParams {
			amp: string;
			gamma: string;
			mid_fee: string;
			out_fee: string;
			fee_gamma: string;
			repeg_profit_threshold: string;
			min_price_scale_delta: string;
			price_scale: string;
			ma_half_time: number;
			track_asset_balances: boolean;
		}

		const [poolState, d, config]: [PoolState, number, PCLConfigResponse] = await Promise.all([
			_wasmQueryClient.wasm.queryContractSmart("inj1c95v0zr7ah777qn05sqwfnd03le4f40rucs0dp", {
				pool: {},
			}),
			_wasmQueryClient.wasm.queryContractSmart("inj1c95v0zr7ah777qn05sqwfnd03le4f40rucs0dp", { compute_d: {} }),
			_wasmQueryClient.wasm.queryContractSmart("inj1c95v0zr7ah777qn05sqwfnd03le4f40rucs0dp", {
				config: {},
			}),
		]);

		const configParams: PCLConfigParams = JSON.parse(fromAscii(fromBase64(config.params)));
		const [assets, dexname, totalShare] = processPoolStateAssets(poolState);

		const pclPool: PCLPool = {
			assets: assets,
			totalShare: totalShare,
			address: "inj1c95v0zr7ah777qn05sqwfnd03le4f40rucs0dp",
			dexname: AmmDexName.default,
			pairType: PairType.pcl,
			inputfee: 0,
			outputfee: 0.3,
			LPratio: 0,
			factoryAddress: "",
			routerAddress: "",
			D: Number(d),
			amp: +configParams.amp,
			gamma: +configParams.gamma,
			priceScale: +configParams.price_scale,
			feeGamma: +configParams.fee_gamma,
			midFee: +configParams.mid_fee,
			outFee: +configParams.out_fee,
		};

		/*expected outcome: {
  "return_amount": "249260514562831308",
  "spread_amount": "484148904998105",
  "commission_amount": "698611467674416"
}*/
		const offerAsset: Asset = {
			info: {
				native_token: {
					denom: "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7",
				},
			},
			amount: "10000000",
		};
		const out0 = outGivenIn(pclPool, offerAsset);
		const outSimulated = await _wasmQueryClient.wasm.queryContractSmart(
			"inj1c95v0zr7ah777qn05sqwfnd03le4f40rucs0dp",
			{ simulation: { offer_asset: offerAsset } },
		);
		console.log(out0, fromChainAsset({ amount: outSimulated.return_amount, info: out0.info }))
		assert.closeTo(+out0.amount, BigNumber("249260.514562831308").toNumber(), 1);
	});
});

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
