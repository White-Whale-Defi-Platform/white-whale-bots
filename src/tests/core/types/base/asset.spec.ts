import BigNumber from "bignumber.js";
import { assert } from "chai";
import dotenv from "dotenv";
import { describe } from "mocha";

import { Asset, fromChainAsset, toChainAsset, toChainPrice } from "../../../../core/types/base/asset";
// load env files
dotenv.config();

describe("Test convert 18 to 6 decimal asset and vice versa", () => {
	it("Should return 6 decimal asset after 18 decimal input 'inj' denom converting FROM chain", async () => {
		const input: Asset = {
			amount: String(new BigNumber(5).multipliedBy(new BigNumber(10).pow(18))),
			info: { native_token: { denom: "inj" } },
		};

		const output = fromChainAsset(input);

		const times = +input.amount / +output.amount;
		assert.equal(times, 1e12);
	});

	it("Should return 6 decimal asset after 6 decimal input non 'inj' denom FROM chain", async () => {
		const input: Asset = {
			amount: String(new BigNumber(5).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "uwhale" } },
		};

		const output = fromChainAsset(input);

		assert.equal(input, output);
	});

	it("Should return 18 decimal asset after 6 decimal input 'inj' denom TO chain", async () => {
		const input: Asset = {
			amount: String(new BigNumber(5).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "inj" } },
		};

		const output = toChainAsset(input);

		const times = +output.amount / +input.amount;
		assert.equal(times, 1e12);
	});

	it("Should return 6 decimal asset after 6 decimal input 'uwhale' denom TO chain", async () => {
		const input: Asset = {
			amount: String(new BigNumber(5).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "uwhale" } },
		};

		const output = toChainAsset(input);

		assert.equal(input, output);
	});
});

describe("Test convert 18 to 6 decimal prices and vice versa", () => {
	it("Should return 18 decimal compensated price for 'inj' input", async () => {
		const input: Asset = {
			amount: String(new BigNumber(5).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "inj" } },
		};
		const output: Asset = {
			amount: String(new BigNumber(3).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "uwhale" } },
		};
		const chainPrice = toChainPrice(input, output);
		assert.equal(+chainPrice, (Math.round((5 / 3) * 1e6) / 1e6) * 1e12);
	});
	it("Should return 18 decimal compensated price for 'inj' output", async () => {
		const input: Asset = {
			amount: String(new BigNumber(5).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "uwhale" } },
		};
		const output: Asset = {
			amount: String(new BigNumber(3).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "inj" } },
		};
		const chainPrice = toChainPrice(input, output);
		assert.equal(+chainPrice, new BigNumber(Math.round((5 / 3) * 1e6) / 1e6).dividedBy(1e12).toNumber());
	});

	it("Should not compensate price for non 'inj' in-and-output", async () => {
		const input: Asset = {
			amount: String(new BigNumber(5).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "uwhale" } },
		};
		const output: Asset = {
			amount: String(new BigNumber(3).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "ujuno" } },
		};
		const chainPrice = toChainPrice(input, output);
		assert.equal(+chainPrice, Math.round((5 / 3) * 1e6) / 1e6);
	});
});
