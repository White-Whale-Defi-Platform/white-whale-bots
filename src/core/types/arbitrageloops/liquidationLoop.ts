import { Loans, Overseer } from "../base/overseer";

/**
 *
 */
export class LiquidationLoop {
	overseers: Array<Overseer>;
	loans: Loans;

	/**
	 *
	 */
	constructor(overseers: Array<Overseer>, loans: Loans) {
		this.overseers = overseers;
		this.loans = loans;
	}
}
