import { parseCoins } from "@cosmjs/stargate";
import { assert, expect } from "chai";
import { describe } from "mocha";

describe("Test MsgExecuteContractCompat coinstring to coin-type", () => {
	it("Should return Cointype from string", async () => {
		const input = "10000uwhale";

		const output = parseCoins(input)[0];
		assert.property(output, "denom", "denom doesnt exist on converted type");
		assert.property(output, "amount", "amount doesnt exist on converted type");
		assert.equal(output.denom, "uwhale");
		assert.equal(output.amount, "10000");
	});
	it("Should error on wrong input coinstring", () => {
		expect(() => parseCoins("0")).to.throw(Error, "Got an invalid coin string");
	});
	it("Should handle multiple input coinstrings", () => {
		const input = "1000uwhale,2000ujuno";
		const output = parseCoins(input);
		for (const coin of output) {
			assert.property(coin, "denom", "denom doesnt exist on converted type");
			assert.property(coin, "amount", "amount doesnt exist on converted type");
		}
		assert.lengthOf(output, 2);
	});
});
