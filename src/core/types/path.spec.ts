// import assert from "assert";
// import { describe } from "mocha";

// import { identity } from "../identity";
// import { Asset } from "./asset";
// import { getPathsFromPool, Path } from "./path";
// import { Pool } from "./pool";

// const assets = {
// 	luna: identity<Asset>({
// 		amount: "1000",
// 		info: { native_token: { denom: "uluna" } },
// 	}),
// 	atom: identity<Asset>({
// 		amount: "4000",
// 		info: { native_token: { denom: "uatom" } },
// 	}),
// 	juno: identity<Asset>({
// 		amount: "6000",
// 		info: { native_token: { denom: "ujuno" } },
// 	}),
// };

// describe("core/path/getPathsFromPool", () => {
// 	it("does get paths", () => {
// 		const pools: Array<Pool> = [
// 			{
// 				address: "pool1",
// 				assets: [{ ...assets["luna"] }, { ...assets["atom"] }],
// 				totalShare: "3000",
// 				type: "default",
// 				factoryAddress: "",
// 				routerAddress: "",

// 				fee: 0.3,
// 			},
// 			{
// 				address: "pool2",
// 				assets: [{ ...assets["atom"] }, { ...assets["juno"] }],
// 				totalShare: "7000",
// 				type: "default",
// 				fee: 0.3,
// 				factoryAddress: "",
// 				routerAddress: "",
// 			},
// 			{
// 				address: "pool3",
// 				assets: [{ ...assets["juno"] }, { ...assets["luna"] }],
// 				totalShare: "10000",
// 				type: "default",
// 				fee: 0.3,
// 				factoryAddress: "",
// 				routerAddress: "",
// 			},
// 		];

// 		assert.deepEqual(
// 			getPathsFromPool(pools),
// 			[
// 				identity<Path>({
// 					pools: [
// 						{
// 							address: "pool1",
// 							assets: [{ ...assets["luna"] }, { ...assets["atom"] }],
// 							totalShare: "3000",
// 							type: "default",
// 							fee: 0.3,
// 							factoryAddress: "",
// 							routerAddress: "",
// 						},
// 						{
// 							address: "pool2",
// 							assets: [{ ...assets["luna"] }, { ...assets["atom"] }],
// 							totalShare: "3000",
// 							type: "default",
// 							fee: 0.3,
// 							factoryAddress: "",
// 							routerAddress: "",
// 						},
// 					],
// 				}),
// 			],
// 			"Expected all pools to be created",
// 		);
// 	});
// });
