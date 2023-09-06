import { Coin } from "@cosmjs/stargate";
import { inspect } from "util";

import { PriceFeedMessage } from "../messages/liquidationmessages";

export interface Overseer {
	overseerAddress: string;
}

export interface AnchorOverseer extends Overseer {
	oracleAddress: string;
	marketAddress: string;
	liquidatorAddress: string;
	priceFeeders?: Array<string>;
	priceFeed: PriceFeed;
	whitelist: AnchorWhitelist;
	loans: Loans;
	stableDenom: string;
}

export interface AnchorWhitelist {
	elems: Array<AnchorWhitelistElement>;
}

interface AnchorWhitelistElement {
	name: string;
	symbol: string;
	max_ltv: string;
	custody_contract: string;
	collateral_token: string;
}

export type Loans = { [borrower: string]: Loan };

export interface Loan {
	borrowerAddress: string;
	collaterals: { [address: string]: { amount: number; ltv: number } };
	borrowLimit: number;
	riskRatio: number;
	loanAmt: number;
}

export type PriceFeed = Map<string, number>;

/**
 * Update prices.
 */
export function setPriceFeed(overseer: AnchorOverseer, msg: PriceFeedMessage) {
	for (const priceFeedEntry of msg.feed_price.prices) {
		overseer.priceFeed.set(priceFeedEntry[0], +priceFeedEntry[1]);
	}
}

/**
 *
 */
export function setBorrowLimits(overseer: AnchorOverseer) {
	for (const loan of Object.values(overseer.loans)) {
		if (loan.collaterals) {
			let newLTV = 0;
			for (const collateralToken of Object.keys(loan.collaterals)) {
				const tokenPrice = overseer.priceFeed.get(collateralToken);
				if (tokenPrice) {
					newLTV =
						newLTV +
						loan.collaterals[collateralToken].amount * tokenPrice * loan.collaterals[collateralToken]!.ltv;
				}
			}
			loan.borrowLimit = newLTV;
			loan.riskRatio = loan.loanAmt / loan.borrowLimit;
		}
	}
}

/**
 *
 */
export function adjustCollateral(
	overseer: AnchorOverseer,
	sender: string,
	collaterals: Array<[string, string]>,
	add: boolean,
) {
	const loan = overseer.loans[sender];

	if (!loan) {
		const loan: Loan = {
			borrowerAddress: sender,
			collaterals: {},
			borrowLimit: 0,
			riskRatio: 0,
			loanAmt: 0,
		};
		for (const collateral of collaterals) {
			const ltv = overseer.whitelist.elems.filter((elem) => elem.collateral_token === collateral[0])[0].max_ltv;
			loan.collaterals[collateral[0]] = { amount: +collateral[1], ltv: +ltv };
		}
		overseer.loans[sender] = loan;
		return;
	} else {
		console.log("loan before: ", inspect(loan, true, 3, true));
		for (const collateral of collaterals) {
			if (loan.collaterals[collateral[0]]) {
				if (add) {
					loan.collaterals[collateral[0]].amount = loan.collaterals[collateral[0]].amount + +collateral[1];
				} else {
					loan.collaterals[collateral[0]].amount = loan.collaterals[collateral[0]].amount - +collateral[1];
				}
			} else {
				const ltv = overseer.whitelist.elems.filter((elem) => elem.collateral_token === collateral[0])[0]
					.max_ltv;
				loan.collaterals[collateral[0]] = { amount: loan.collaterals[collateral[0]].amount, ltv: +ltv };
			}
		}
		console.log("loan after: ", inspect(loan, true, 3, true));
	}
}

/**
 *
 */
export function borrowStable(overseer: AnchorOverseer, sender: string, amount: string) {
	const loan = overseer.loans[sender];
	if (!loan) {
		//create new loan?
		return;
	} else {
		loan.loanAmt = loan.loanAmt + +amount;
	}
}

/**
 *
 */
export function repayStable(overseer: AnchorOverseer, sender: string, coins: Array<Coin>) {
	const loan = overseer.loans[sender];
	if (!loan) {
		//create new loan?
	} else {
		const coin = coins.find((coin) => coin.denom === overseer.stableDenom);
		if (coin) {
			loan.loanAmt = loan.loanAmt - +coin.amount;
		}
	}
}
