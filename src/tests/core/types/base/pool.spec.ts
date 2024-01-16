import BigNumber from "bignumber.js";
import { assert } from "chai";
import { describe } from "mocha";

import { Asset, RichAsset } from "../../../../core/types/base/asset";
import { AmmDexName, outGivenIn, PairType, PCLPool, Pool } from "../../../../core/types/base/pool";
import { identity } from "../../../../core/types/identity";

describe("Test outGivenIn for pool with 18 and 6 decimal assets", () => {
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
});

describe("Test outGivenIn for pool with 6 and 6 decimal assets", () => {
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
	it("Should return positive number for given swap", async () => {
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
		console.log(`price ${price.toNumber() * 0.997 * +input.amount}, outgivenin: ${+output.amount}`);

		assert.closeTo(price.toNumber() * 0.997 * +input.amount, +output.amount, 100);
	});
});

describe("Test outGivenIn for PCL pool", () => {
	const asset0: RichAsset = {
		info: { native_token: { denom: "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7" } },
		amount: "119049137856",
		decimals: 6,
	};
	const asset1: RichAsset = { amount: "3004379246.755965", info: { native_token: { denom: "inj" } }, decimals: 18 };
	const pclPool: PCLPool = {
		assets: [asset0, asset1],
		totalShare: "18278368578",
		address: "inj1c95v0zr7ah777qn05sqwfnd03le4f40rucs0dp",
		dexname: AmmDexName.default,
		pairType: PairType.pcl,
		inputfee: 0,
		outputfee: 0.3,
		LPratio: 0,
		factoryAddress: "",
		routerAddress: "",
		D: 239345.29781235137,
		amp: 10,
		gamma: 0.000145,
		priceScale: 40.04034110992774,
		midFee: 0.0026,
		outFee: 0.0045,
		feeGamma: 0.00023,
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
	console.log(
		out0,
		"expected: ",
		"249260.514562831308",
		"difference: ",
		Math.abs(+out0.amount - BigNumber("249260.514562831308").toNumber()),
	);
});

/*example outgivenin setup and actual received numbers on-chain:
STATE
 "assets": [
    {
      "info": {
        "native_token": {
          "denom": "inj"
        }
      },
      "amount": "144264.731967.836615185675"
    },
    {
      "info": {
        "native_token": {
          "denom": "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7"
        }
      },
      "amount": "946834545199"
    }
  ],
  "total_share": "357638203545997474"
}

SWAP
{
  "simulation": {
    "offer_asset": {
      "amount": "27244227",
      "info": {
        "native_token": {
          "denom": "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7"
        }
      }
    }
  }
}

RESULT
  "return_amount": "4138502584293659410",
  "spread_amount": "119439635084826",
  "commission_amount": "12452866351936788"
}
*/
