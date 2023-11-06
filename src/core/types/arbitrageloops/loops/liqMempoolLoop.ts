import { fromUtf8 } from "@cosmjs/encoding";
import { StdFee } from "@cosmjs/stargate";

import { getliqudationMessage } from "../../../../chains/defaults/messages/getLiquidationMessage";
import { initLiquidationOverseers } from "../../../../chains/defaults/queries/initOverseers";
import { tryLiquidationArb } from "../../../arbitrage/arbitrage";
import { ChainOperator } from "../../../chainOperator/chainoperator";
import { Logger } from "../../../logging";
import { LiquidationConfig } from "../../base/configs";
import { LogType } from "../../base/logging";
import { decodeMempool, IgnoredAddresses, Mempool, MempoolTx } from "../../base/mempool";
import {
	adjustCollateral,
	AnchorOverseer,
	borrowStable,
	repayStable,
	setBorrowLimits,
	setPriceFeed,
} from "../../base/overseer";
import {
	isBorrowStableMessage,
	isLockCollateralMessage,
	isRepayStableMessage,
	isUnlockCollateralMessage,
	PriceFeedMessage,
} from "../../messages/liquidationmessages";
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
	logger: Logger | undefined;
	mempool!: Mempool;
	overseers: Array<AnchorOverseer>;
	totalBytes = 0;
	allOverseerAddresses: Record<string, AnchorOverseer> = {};
	allOverseerPriceFeeders: Record<string, AnchorOverseer> = {};
	allOverseerMoneyMarkets: Record<string, AnchorOverseer> = {};

	/**
	 *
	 */
	constructor(
		chainOperator: ChainOperator,
		botConfig: LiquidationConfig,
		overseers: Array<AnchorOverseer>,
		logger: Logger,
	) {
		this.botConfig = botConfig;
		this.overseers = overseers;
		this.chainOperator = chainOperator;
		this.logger = logger;

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
	static async createLoop(chainOperator: ChainOperator, botConfig: LiquidationConfig, logger: Logger) {
		if (botConfig.useMempool === false || botConfig.skipConfig?.useSkip === true) {
			await logger.sendMessage(
				"Currently not possible to start liquidation bot without mempool or with skip",
				LogType.Console,
			);
			process.exit(1);
		}
		const overseers = await initLiquidationOverseers(botConfig.overseerAddresses, chainOperator);
		return new LiquidationLoop(chainOperator, botConfig, overseers, logger);
	}

	/**
	 *
	 */
	public async step() {
		this.iterations++;
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

		const mempoolTxs: Array<MempoolTx> = decodeMempool(this.mempool, this.ignoreAddresses, 0, this.iterations);
		if (mempoolTxs.length > 0) {
			this.applyMempoolMessagesOnLiquidation(mempoolTxs);
		}
		const toLiquidate = tryLiquidationArb(this.overseers, this.botConfig);
		if (toLiquidate?.length !== 0) {
			await this.liquidate(toLiquidate!);
		}
	}
	/**
	 *
	 */
	async liquidate(toLiquidate: Array<[AnchorOverseer, string]>) {
		if (toLiquidate) {
			for (let i = 0; i < toLiquidate.length; i++) {
				const liquidationMessage = getliqudationMessage(
					this.chainOperator.client.publicAddress,
					toLiquidate[i][0].overseerAddress,
					toLiquidate[i][1],
				);
				const TX_FEE: StdFee = {
					amount: [{ amount: String(Number(this.botConfig.gasPrice)*2800000), denom: this.botConfig.gasDenom }],
					gas: "2800000",
				};

				const txResponse = await this.chainOperator.signAndBroadcast([liquidationMessage], TX_FEE);
				if (txResponse.code === 0) {
					this.chainOperator.client.sequence = this.chainOperator.client.sequence + 1;
				}
				const logMessage = `Send Liquidation: ${toLiquidate[i][1]} on ${toLiquidate[i][0].overseerAddress}\n Hash: ${txResponse.transactionHash} Code: ${txResponse.code}`
				await this.logger?.sendMessage(logMessage, LogType.All, txResponse.code);
				await delay(5000);
			}
		}
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
	/**
	 *
	 */
	public clearIgnoreAddresses() {
		return;
	}

	/**
	 *
	 */
	async reset() {
		return;
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
