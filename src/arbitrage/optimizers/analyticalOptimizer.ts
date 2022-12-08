import { AssetInfo } from "../../types/core/asset";
import { Path } from "../../types/core/path";
import { getAssetsOrder } from "../../types/core/pool";
/**
 *
 */

// function to get the optimal tradsize and profit for a single path.
// it assumes the token1 from pool1 is the same asset as token1 from pool2 and
// token2 from pool1 equals the asset from token2 from pool2. e.g. A->B (pool1) then B->A (pool2).
/**
 *
 */
function getTradesizeAndProfitForPath(path: Path, offerAssetInfo: AssetInfo): [number, number] {
	// input token from the first pool equals out token from second pool

	let in0: number;
	let out0: number;

	let in1: number;
	let out1: number;
	if (path.pools.length == 2) {
		const [inAsset0, outAsset0] = getAssetsOrder(path.pools[0], offerAssetInfo) ?? [];
		const [inAsset1, outAsset1] = getAssetsOrder(path.pools[1], outAsset0.info) ?? [];

		const in0 = +inAsset0.amount;
		const out0 = +outAsset0.amount;
		const in1 = +inAsset1.amount;
		const out1 = +outAsset1.amount;

		const pool0fee = path.pools[0].fee / 100;
		const pool1fee = path.pools[1].fee / 100;
		const x1 =
			(in0 * in1 - Math.sqrt(((pool0fee - 1) * pool1fee - pool0fee + 1) * in0 * in1 * out1 * out0)) /
			((pool0fee - 1) * out0 - in1);
		const x2 =
			(in0 * in1 + Math.sqrt(((pool0fee - 1) * pool1fee - pool0fee + 1) * in0 * in1 * out1 * out0)) /
			((pool0fee - 1) * out0 - in1);
		const x = Math.min(Math.floor(Math.max(x1, x2)), 1000000000);
		const profit =
			(-(pool0fee - 1) * (pool1fee - 1) * out1 * out0 * x) /
				((((pool0fee - 1) * out0 * x) / (in0 + x) - in1) * (in0 + x)) -
			x;

		return [x, Math.round(profit)];
	} else if (path.pools.length == 3) {
		const [inAsset0, outAsset0] = getAssetsOrder(path.pools[0], offerAssetInfo) ?? [];
		const [inAsset1, outAsset1] = getAssetsOrder(path.pools[1], outAsset0.info) ?? [];
		const [inAsset2, outAsset2] = getAssetsOrder(path.pools[2], outAsset1.info) ?? [];

		const in0 = +inAsset0.amount;
		const out0 = +outAsset0.amount;
		const in1 = +inAsset1.amount;
		const out1 = +outAsset1.amount;
		const in2 = +inAsset2.amount;
		const out2 = +outAsset2.amount;

		const pool0fee = path.pools[0].fee / 100;
		const pool1fee = path.pools[1].fee / 100;
		const pool2fee = path.pools[2].fee / 100;
		const x1 =
			-(
				in0 * in1 * in2 +
				Math.sqrt(
					-in0 * in1 * in2 * out0 * out1 * out2 * pool0fee +
						in0 * in1 * in2 * out0 * out1 * out2 +
						(in0 * in1 * in2 * out0 * out1 * out2 * pool0fee - in0 * in1 * in2 * out0 * out1 * out2) *
							pool1fee +
						(in0 * in1 * in2 * out0 * out1 * out2 * pool0fee -
							in0 * in1 * in2 * out0 * out1 * out2 -
							(in0 * in1 * in2 * out0 * out1 * out2 * pool0fee - in0 * in1 * in2 * out0 * out1 * out2) *
								pool1fee) *
							pool2fee,
				)
			) /
			(in1 * in2 +
				in2 * out0 +
				out0 * out1 -
				(in2 * out0 + out0 * out1) * pool0fee +
				(out0 * out1 * pool0fee - out0 * out1) * pool1fee);
		const x2 =
			-(
				in0 * in1 * in2 -
				Math.sqrt(
					-in0 * in1 * in2 * out0 * out1 * out2 * pool0fee +
						in0 * in1 * in2 * out0 * out1 * out2 +
						(in0 * in1 * in2 * out0 * out1 * out2 * pool0fee - in0 * in1 * in2 * out0 * out1 * out2) *
							pool1fee +
						(in0 * in1 * in2 * out0 * out1 * out2 * pool0fee -
							in0 * in1 * in2 * out0 * out1 * out2 -
							(in0 * in1 * in2 * out0 * out1 * out2 * pool0fee - in0 * in1 * in2 * out0 * out1 * out2) *
								pool1fee) *
							pool2fee,
				)
			) /
			(in1 * in2 +
				in2 * out0 +
				out0 * out1 -
				(in2 * out0 + out0 * out1) * pool0fee +
				(out0 * out1 * pool0fee - out0 * out1) * pool1fee);
		const x = Math.min(Math.floor(Math.max(x1, x2)), 1000000000);

		const profit =
			(-out0 * out1 * out2 * (pool0fee - 1) * (pool1fee - 1) * (pool2fee - 1) * x) /
				(((out0 * out1 * (pool0fee - 1) * (pool1fee - 1) * x) /
					(((out0 * (pool0fee - 1) * x) / (in0 + x) - in1) * (in0 + x)) -
					in2) *
					((out0 * (pool0fee - 1) * x) / (in0 + x) - in1) *
					(in0 + x)) -
			x;
		return [x, Math.round(profit)];
	} else {
		return [-1, -1];
	}
}

/**
 *
 */
export function getOptimalTrade(paths: Array<Path>, offerAssetInfo: AssetInfo): [Path | undefined, number, number] {
	let maxTradesize = 0;
	let maxProfit = 0;
	let maxPath;

	paths.map((path: Path) => {
		const [tradesize, profit] = getTradesizeAndProfitForPath(path, offerAssetInfo);
		if (profit > maxProfit && tradesize > 0) {
			maxProfit = profit;
			maxTradesize = tradesize;
			maxPath = path;
		}
	});
	return [maxPath, maxTradesize, maxProfit];
}
