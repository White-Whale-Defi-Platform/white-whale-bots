import { fromUtf8 } from "@cosmjs/encoding";
import { StdFee } from "@cosmjs/stargate";

import { getliqudationMessage } from "../../../chains/defaults/messages/getLiquidationMessage";
import { tryLiquidationArb } from "../../arbitrage/arbitrage";
import { ChainOperator } from "../../chainOperator/chainoperator";
import { LiquidationConfig } from "../base/configs";
import { decodeMempool, IgnoredAddresses, Mempool, MempoolTx } from "../base/mempool";
import {
	adjustCollateral,
	AnchorOverseer,
	borrowStable,
	repayStable,
	setBorrowLimits,
	setPriceFeed,
} from "../base/overseer";
import {
	isBorrowStableMessage,
	isLockCollateralMessage,
	isRepayStableMessage,
	isUnlockCollateralMessage,
	PriceFeedMessage,
} from "../messages/liquidationmessages";
/*
 *
 */
/**
 *
 */
export class LiquidationLoop {
	botConfig: LiquidationConfig;
	chainOperator: ChainOperator;
	ignoreAddresses: IgnoredAddresses = {};
	iterations = 0;
	mempool!: Mempool;
	overseers: Array<AnchorOverseer>;
	totalBytes = 0;
	allOverseerAddresses: Record<string, AnchorOverseer> = {};
	allOverseerPriceFeeders: Record<string, AnchorOverseer> = {};
	allOverseerMoneyMarkets: Record<string, AnchorOverseer> = {};

	/**
	 *
	 */
	constructor(chainOperator: ChainOperator, botConfig: LiquidationConfig, overseers: Array<AnchorOverseer>) {
		this.botConfig = botConfig;
		this.overseers = overseers;
		this.chainOperator = chainOperator;

		overseers.map((overseer) => {
			this.allOverseerAddresses[overseer.overseerAddress] = overseer;
			if (overseer.priceFeeders) {
				for (const priceFeedAddress of overseer.priceFeeders) {
					this.allOverseerPriceFeeders[priceFeedAddress] = overseer;
				}
			}
			this.allOverseerMoneyMarkets[overseer.marketAddress] = overseer;
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
		if (mempoolTxs.length > 0) {
			this.applyMempoolMessagesOnLiquidation(mempoolTxs);
		}
		const toLiquidate = tryLiquidationArb(this.overseers, this.botConfig);
		if (toLiquidate) {
			await this.liquidate(...toLiquidate);
		}
	}
	/**
	 *
	 */
	async liquidate(overseer: AnchorOverseer, address: string) {
		const liquidationMessage = getliqudationMessage(
			this.chainOperator.client.publicAddress,
			overseer.overseerAddress,
			address,
		);
		const TX_FEE: StdFee = { amount: [{ amount: String(42000), denom: this.botConfig.gasDenom }], gas: "2800000" };

		const txResponse = await this.chainOperator.signAndBroadcast([liquidationMessage], TX_FEE);
		if (txResponse.code === 0) {
			this.chainOperator.client.sequence = this.chainOperator.client.sequence + 1;
		}
		console.log(txResponse);
		await delay(5000);
	}
	/**
	 *
	 */
	applyMempoolMessagesOnLiquidation(mempoolTxs: Array<MempoolTx>) {
		const overseersToUpdate: Array<AnchorOverseer> = [];
		for (const tx of mempoolTxs) {
			const message = JSON.parse(fromUtf8(tx.message.msg));
			const pfOverseer = this.allOverseerPriceFeeders[tx.message.sender];
			if (pfOverseer) {
				const pfMessage = <PriceFeedMessage>message;
				setPriceFeed(pfOverseer, pfMessage);
				overseersToUpdate.push(pfOverseer);
				continue;
			} else {
				const overseer = this.allOverseerAddresses[tx.message.contract];
				if (overseer) {
					if (isLockCollateralMessage(message)) {
						adjustCollateral(overseer, tx.message.sender, message.lock_collateral.collaterals, true);
					} else if (isUnlockCollateralMessage(message)) {
						adjustCollateral(overseer, tx.message.sender, message.unlock_collateral.collaterals, false);
					}
					overseersToUpdate.push(overseer);
					continue;
				} else {
					const mm = this.allOverseerMoneyMarkets[tx.message.contract];

					if (mm) {
						if (isBorrowStableMessage(message)) {
							//borrow stable handler
							borrowStable(mm, tx.message.sender, message.borrow_stable.borrow_amount);
							//borrow stable handler
						} else if (isRepayStableMessage(message)) {
							//handle repay stable
							repayStable(overseer, tx.message.sender, tx.message.funds);
						}
						overseersToUpdate.push(mm);
						continue;
					}
				}
			}
		}
		for (const overseer of Array.from(new Set(overseersToUpdate))) {
			setBorrowLimits(overseer);
		}
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
