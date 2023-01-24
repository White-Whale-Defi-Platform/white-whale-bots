import { AssetInfo } from "../../types/core/asset";
import { Path } from "../../types/core/path";
import { getAssetsOrder, outGivenIn } from "../../types/core/pool";

// function to get the optimal tradsize and profit for a single path.
// it assumes the token1 from pool1 is the same asset as token1 from pool2 and
// token2 from pool1 equals the asset from token2 from pool2. e.g. A->B (pool1) then B->A (pool2).
/**
 *@deprecated Prefer cyclical method in getTradeForPath. This function is used for debugging and comparing both.
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

		const pool0fee = Math.max(path.pools[0].outputfee, path.pools[0].inputfee) / 100;
		const pool1fee = Math.max(path.pools[1].outputfee, path.pools[1].inputfee) / 100;
		const x1 =
			(in0 * in1 - Math.sqrt(((pool0fee - 1) * pool1fee - pool0fee + 1) * in0 * in1 * out1 * out0)) /
			((pool0fee - 1) * out0 - in1);
		const x2 =
			(in0 * in1 + Math.sqrt(((pool0fee - 1) * pool1fee - pool0fee + 1) * in0 * in1 * out1 * out0)) /
			((pool0fee - 1) * out0 - in1);
		const x = Math.min(Math.floor(Math.max(x1, x2)), 1000000000);
		let currentOfferAsset = { amount: String(x), info: offerAssetInfo };
		for (let i = 0; i < path.pools.length; i++) {
			const [outAmount, outInfo] = outGivenIn(path.pools[i], currentOfferAsset);
			currentOfferAsset = { amount: String(outAmount), info: outInfo };
		}
		const profit = +currentOfferAsset.amount - x;

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

		const pool0fee = Math.max(path.pools[0].outputfee, path.pools[0].inputfee) / 100;
		const pool1fee = Math.max(path.pools[1].outputfee, path.pools[1].inputfee) / 100;
		const pool2fee = Math.max(path.pools[2].outputfee, path.pools[2].inputfee) / 100;
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
		let currentOfferAsset = { amount: String(x), info: offerAssetInfo };
		for (let i = 0; i < path.pools.length; i++) {
			const [outAmount, outInfo] = outGivenIn(path.pools[i], currentOfferAsset);
			currentOfferAsset = { amount: String(outAmount), info: outInfo };
		}
		const profit = +currentOfferAsset.amount - x;
		return [x, Math.round(profit)];
	} else {
		return [-1, -1];
	}
}

/** Function to calculate the optimal path, tradesize and profit given an Array of paths and a starting asset.
 * @param paths Type `Array<Path>` to check for arbitrage.
 * @param offerAssetInfo Type `AssetInfo` to start the arbitrage from.
 */
export function getOptimalTrade(paths: Array<Path>, offerAssetInfo: AssetInfo): [Path | undefined, number, number] {
	let maxTradesize = 0;
	let maxProfit = 0;
	let maxPath;

	paths.map((path: Path) => {
		const [tradesize, profit] = getOptimalTradeForPath(path, offerAssetInfo);
		if (profit > maxProfit && tradesize > 0) {
			maxProfit = profit;
			maxTradesize = tradesize;
			maxPath = path;
		}
	});
	return [maxPath, maxTradesize, maxProfit];
}

/** Given an ordered route, calculate the optimal amount into the first pool that maximizes the profit of swapping through the route
*	Implements n-pool cylic arb from this paper: https://arxiv.org/abs/2105.02784.
*	Extends algo to have varying swap fees for each pool.
    @param path Path of type `Path` to calculate the optimal tradesize for.
	@param offerAssetInfo OfferAsset type `AssetInfo` from which the arbitrage path starts. 
    @returns [optimal tradesize, expected profit] for this particular path.
 */
export function getOptimalTradeForPath(path: Path, offerAssetInfo: AssetInfo): [number, number] {
	const assetBalances = [];
	let offerAssetNext = offerAssetInfo;
	for (let i = 0; i < path.pools.length; i++) {
		const [inAsset, outAsset] = getAssetsOrder(path.pools[i], offerAssetNext) ?? [];
		offerAssetNext = outAsset.info;
		assetBalances.push([+inAsset.amount, +outAsset.amount]);
	}

	// # Set the aprime_in and aprime_out to the first pool in the route
	let [aprime_in, aprime_out] = assetBalances[0];

	// # Set the r1_first and r2_first to the first pool in the route
	const [r1_first, r2_first] = [1 - path.pools[0].inputfee / 100, 1 - path.pools[0].outputfee / 100];

	// # Iterate through the route
	for (let i = 1; i < assetBalances.length; i++) {
		// # Set the a_in and a_out to the current pool in the route
		const [a_in, a_out] = assetBalances[i];
		// # Set the r1 and r2 to the current pool in the route
		const [r1, r2] = [1 - path.pools[i].inputfee / 100, 1 - path.pools[i].outputfee / 100];
		// # Calculate the aprime_in
		aprime_in = (aprime_in * a_in) / (a_in + r1 * r2 * aprime_out);
		// # Calculate the aprime_out
		aprime_out = (r1 * r2 * aprime_out * a_out) / (a_in + r1 * r2 * aprime_out);
	}
	// # Calculate the delta_a
	const delta_a = Math.floor((Math.sqrt(r1_first * r2_first * aprime_in * aprime_out) - aprime_in) / r1_first);

	let currentOfferAsset = { amount: String(delta_a), info: offerAssetInfo };
	for (let i = 0; i < path.pools.length; i++) {
		const [outAmount, outInfo] = outGivenIn(path.pools[i], currentOfferAsset);
		currentOfferAsset = { amount: String(outAmount), info: outInfo };
	}
	const profit = +currentOfferAsset.amount - delta_a;

	// # Return the floor of delta_a
	return [delta_a, profit];
}
