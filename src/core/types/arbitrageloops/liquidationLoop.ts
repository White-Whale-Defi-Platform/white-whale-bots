import { fromUtf8 } from "@cosmjs/encoding";

import { ChainOperator } from "../../chainOperator/chainoperator";
import { BotConfig } from "../base/botConfig";
import { decodeMempool, IgnoredAddresses, Mempool, MempoolTx } from "../base/mempool";
import { adjustCollateral, AnchorOverseer, setBorrowLimits, setPriceFeed } from "../base/overseer";
import { isLockCollateralMessage, isUnlockCollateralMessage } from "../messages/collateralmessage";
import { isBorrowStableMessage, isRepayStableMessage } from "../messages/loanmessage";
import { PriceFeedMessage } from "../messages/pricefeedmessage";
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
	allOverseerAddresses: Record<string, AnchorOverseer> = {};
	allOverseerPriceFeeders: Record<string, AnchorOverseer> = {};
	allOverseerMoneyMarkets: Record<string, AnchorOverseer> = {};

	/**
	 *
	 */
	constructor(chainOperator: ChainOperator, botConfig: BotConfig, overseers: Array<AnchorOverseer>) {
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
		this.applyMempoolMessagesOnLiquidation(mempoolTxs);
	}

	/**
	 *
	 */
	applyMempoolMessagesOnLiquidation(mempoolTxs: Array<MempoolTx>) {
		for (const tx of mempoolTxs) {
			const message = JSON.parse(fromUtf8(tx.message.msg));
			const pfOverseer = this.allOverseerPriceFeeders[tx.message.sender];
			if (pfOverseer) {
				const pfMessage = <PriceFeedMessage>message;
				setPriceFeed(pfOverseer, pfMessage);
				setBorrowLimits(pfOverseer);
				console.log("new price feed");
				continue;
			} else {
				const overseer = this.allOverseerAddresses[tx.message.contract];
				if (overseer) {
					console.log("new overseer message");
					if (isLockCollateralMessage(message)) {
						adjustCollateral(overseer, tx.message.sender, message.lock_collateral.collaterals, true);
					} else if (isUnlockCollateralMessage(message)) {
						adjustCollateral(overseer, tx.message.sender, message.unlock_collateral.collaterals, false);
					}
					continue;
				} else {
					const mm = this.allOverseerMoneyMarkets[tx.message.contract];

					if (mm) {
						console.log("new money market message");
						if (isBorrowStableMessage(message)) {
							//borrow stable handler
							borrowStable(
								overseer,
								tx.message.sender,
								message.borrow_stable.borrow_amount,
								message.borrow_stable.to,
							);
						} else if (isRepayStableMessage(message)) {
							//handle repay stable
						}
						continue;
					}
				}
			}
		}
	}
}
