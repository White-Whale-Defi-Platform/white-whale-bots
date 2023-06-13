import { ChainOperator } from "../../chainOperator/chainoperator";
import { BotConfig } from "../base/botConfig";
import { decodeMempool, IgnoredAddresses, Mempool, MempoolTx } from "../base/mempool";
import { AnchorOverseer } from "../base/overseer";

/**
 *
 */
export class LiquidationLoop {
	botConfig: BotConfig;
	chainOperator: ChainOperator;
	ignoreAddresses: IgnoredAddresses = {};
	iterations = 0;
	mempool!: Mempool;
	overseers: Array<AnchorOverseer>;
	totalBytes = 0;
	allOverseerAddresses: Array<string> = [];
	allOverseerPriceFeeders: Array<string> = [];
	allOverseerMoneyMarkets: Array<string> = [];

	/**
	 *
	 */
	constructor(chainOperator: ChainOperator, botConfig: BotConfig, overseers: Array<AnchorOverseer>) {
		this.botConfig = botConfig;
		this.overseers = overseers;
		this.chainOperator = chainOperator;

		overseers.map((overseer) => {
			this.allOverseerAddresses.push(overseer.overseerAddress);
			if (overseer.priceFeeders) {
				this.allOverseerPriceFeeders.push(...overseer.priceFeeders);
			}
			this.allOverseerMoneyMarkets.push(overseer.marketAddress);
		});
	}

	/**
	 *
	 */
	public async step() {
		while (true) {
			this.mempool = await this.chainOperator.queryMempool();

			if (+this.mempool.total_bytes < this.totalBytes) {
				break;
			} else if (+this.mempool.total_bytes === this.totalBytes) {
				continue;
			} else {
				this.totalBytes = +this.mempool.total_bytes;
			}
		}

		const mempoolTxs: Array<MempoolTx> = decodeMempool(this.mempool, this.ignoreAddresses, this.iterations);
	}

	/**
	 *
	 */
	applyMempoolMessagesOnLiquidation(mempoolTxs: Array<MempoolTx>) {
		for (const tx of mempoolTxs) {
			if (this.allOverseerPriceFeeders.includes(tx.message.contract)) {
				// its a price update transaction
			} else if (this.allOverseerAddresses.includes(tx.message.contract)) {
				// its a collateral change action
			} else if (this.allOverseerMoneyMarkets.includes(tx.message.contract)) {
				// its a change in borrow positions
			}
		}
	}
}
