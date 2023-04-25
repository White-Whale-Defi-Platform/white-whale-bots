import BigNumber from "bignumber.js";
import { assert } from "chai";
import { describe } from "mocha";

import { Asset } from "../../../../core/types/base/asset";
import { AmmDexName, outGivenIn, Pool } from "../../../../core/types/base/pool";
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
			},
			{
				info: {
					native_token: {
						denom: "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7",
					},
				},
				amount: "946834545199",
			},
		],
		totalShare: "357638203545997474",
		dexname: AmmDexName.default,
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
		assert.isAbove(output[0], 0);
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
		assert.closeTo(output[0] * 1e12, BigNumber("4138502584293659410").toNumber(), 1000);
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
			},
			{
				info: {
					native_token: {
						denom: "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7",
					},
				},
				amount: "946834545199",
			},
		],
		totalShare: "357638203545997474",
		dexname: AmmDexName.default,
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
		assert.isAbove(output[0], 0);
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
		console.log(`price ${price.toNumber() * 0.997 * +input.amount}, outgivenin: ${output[0]}`);

		assert.closeTo(price.toNumber() * 0.997 * +input.amount, output[0], 100);
	});
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
