import { AccountData } from "@cosmjs/amino";
import { EncodeObject } from "@cosmjs/proto-signing";
import { StdFee } from "@cosmjs/stargate";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { BotClients } from "../../clients/chainclients";
import { Asset, AssetInfo } from "../../types/asset";
import { flushTxMemory, Mempool, MempoolTrade, processMempool } from "../../types/mempool";
import { Path } from "../../types/path";
import { applyMempoolTradesOnPools, Pool } from "../../types/pool";

/**
 *
 */
export class MempoolLoop {
	pools: Array<Pool>;
	paths: Array<Path>;
	botClients: BotClients;
	account: AccountData;
	accountNumber = 0;
	sequence = 0;
	chainid = "";
	offerAssetInfo: AssetInfo;
	minProfits: [number, number];
	tx_fees!: [StdFee, StdFee];

	// CACHE VALUES
	totalBytes = 0;
	mempool!: Mempool;
	iterations = 0;

	/**
	 *
	 */
	arbitrageFunction: (
		paths: Array<Path>,
		offerAssetInfo: AssetInfo,
		[minProfit2Hop, minProfit3Hop]: [number, number],
	) =>
		| {
				path: Path;
				offerAsset: Asset;
		  }
		| undefined;
	updateStateFunction: (botClients: BotClients, pools: Array<Pool>) => void;
	messageFunction: (path: Path, walletAddress: string, offerAsset0: Asset) => [Array<EncodeObject>, number];
	/**
	 *
	 */
	public constructor(
		pools: Array<Pool>,
		paths: Array<Path>,
		arbitrage: (
			paths: Array<Path>,
			offerAssetInfo: AssetInfo,
			[minProfit2Hop, minProfit3Hop]: [number, number],
		) => { path: Path; offerAsset: Asset } | undefined,
		updateState: (botclients: BotClients, pools: Array<Pool>) => void,
		messageFunction: (path: Path, walletAddress: string, offerAsset0: Asset) => [Array<EncodeObject>, number],
		botClients: BotClients,
		account: AccountData,
		offerAssetInfo: AssetInfo,
		[minProfit2Hop, minProfit3Hop]: [number, number],
	) {
		this.pools = pools;
		this.paths = paths;
		this.arbitrageFunction = arbitrage;
		this.updateStateFunction = updateState;
		this.messageFunction = messageFunction;
		this.botClients = botClients;
		this.account = account;
		(this.offerAssetInfo = offerAssetInfo), (this.minProfits = [minProfit2Hop, minProfit3Hop]);
	}
	/**
	 *
	 */
	public async fetchRequiredChainData() {
		const { accountNumber, sequence } = await this.botClients.SigningCWClient.getSequence(this.account.address);
		this.sequence = sequence;
		this.accountNumber = accountNumber;

		const chainId = await this.botClients.SigningCWClient.getChainId();
		this.chainid = chainId;
	}
	/**
	 *
	 */
	public setGasFees(tx_fees: [StdFee, StdFee]) {
		this.tx_fees = tx_fees;
	}
	/**
	 *
	 */
	public async step() {
		this.iterations++;
		this.updateStateFunction(this.botClients, this.pools);

		const arbTrade: { path: Path; offerAsset: Asset } | undefined = this.arbitrageFunction(
			this.paths,
			this.offerAssetInfo,
			this.minProfits,
		);

		if (arbTrade) {
			await this.trade(arbTrade);
			return;
		}

		while (true) {
			const mempoolResult = await this.botClients.HttpClient.execute(createJsonRpcRequest("unconfirmed_txs"));
			this.mempool = mempoolResult.result;

			if (+this.mempool.total_bytes < this.totalBytes) {
				break;
			} else if (+this.mempool.total_bytes === this.totalBytes) {
				continue;
			} else {
				this.totalBytes = +this.mempool.total_bytes;
			}

			const mempoolTrades: Array<MempoolTrade> = processMempool(this.mempool);
			if (mempoolTrades.length === 0) {
				continue;
			} else {
				applyMempoolTradesOnPools(this.pools, mempoolTrades);
			}

			const arbTrade: { path: Path; offerAsset: Asset } | undefined = this.arbitrageFunction(
				this.paths,
				this.offerAssetInfo,
				this.minProfits,
			);

			if (arbTrade) {
				await this.trade(arbTrade);
				break;
			}
		}
	}

	/**
	 *
	 */
	public reset() {
		this.totalBytes = 0;
		flushTxMemory();
	}
	/**
	 *
	 */
	private async trade(arbTrade: { path: Path; offerAsset: Asset }) {
		const [msgs, nrOfMessages] = this.messageFunction(arbTrade.path, this.account.address, arbTrade.offerAsset);
		console.log(msgs);
		const signerData = {
			accountNumber: this.accountNumber,
			sequence: this.sequence,
			chainId: this.chainid,
		};

		const GAS_FEE = nrOfMessages === 2 ? this.tx_fees[0] : this.tx_fees[1];

		// sign, encode and broadcast the transaction
		const txRaw = await this.botClients.SigningCWClient.sign(
			this.account.address,
			msgs,
			GAS_FEE,
			"memo",
			signerData,
		);
		const txBytes = TxRaw.encode(txRaw).finish();
		const sendResult = await this.botClients.TMClient.broadcastTxSync({ tx: txBytes });
		console.log(sendResult);
		this.sequence += 1;
		await delay(3000);
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
