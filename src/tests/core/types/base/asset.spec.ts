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
			amount: String(new BigNumber("512.1234123445245667543").multipliedBy(new BigNumber(10).pow(18))),
			info: { native_token: { denom: "inj" } },
		};

		const output = fromChainAsset(input);
		const times = +input.amount / +output.amount;
		assert.equal(Math.floor(times), 1e12);
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
			amount: String(new BigNumber("512.34123412341234123412341324").multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "inj" } },
		};

		const output = toChainAsset(input);
		const times = Math.round(+output.amount / +input.amount / 1e12);
		assert.equal(times, 1);
	});

	it("Should return 6 decimal asset after 6 decimal input 'uwhale' denom TO chain", async () => {
		const input: Asset = {
			amount: String(new BigNumber(5.0110111).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "uwhale" } },
		};

		const output = toChainAsset(input);
		assert.equal(Math.round(+input.amount), +output.amount);
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

		assert.equal(new BigNumber(chainPrice).toFixed(0), new BigNumber(5 / 3).multipliedBy(1e12).toFixed(0));
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
		assert.equal(chainPrice, new BigNumber(5 / 3).dividedBy(1e12).toFixed(18));
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
		assert.equal(new BigNumber(chainPrice).toFixed(6), new BigNumber(5 / 3).toFixed(6));
	});
	it("Should not compensate price for 'inj' in-and-output", async () => {
		const input: Asset = {
			amount: String(new BigNumber(5).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "inj" } },
		};
		const output: Asset = {
			amount: String(new BigNumber(3).multipliedBy(new BigNumber(10).pow(6))),
			info: { native_token: { denom: "inj" } },
		};
		const chainPrice = toChainPrice(input, output);
		assert.equal(new BigNumber(chainPrice).toFixed(6), new BigNumber(5 / 3).toFixed(6));
	});
});
