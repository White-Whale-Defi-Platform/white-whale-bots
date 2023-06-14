import { PriceFeedMessage } from "../messages/pricefeedmessage";

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

export type Loans = Array<Loan>;

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
	for (const loan of overseer.loans) {
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
