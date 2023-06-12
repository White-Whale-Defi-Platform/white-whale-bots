import { AnchorOverseer } from "../base/overseer";

/**
 *
 */
export class LiquidationLoop {
	overseers: Array<AnchorOverseer>;

	/**
	 *
	 */
	constructor(overseers: Array<AnchorOverseer>) {
		this.overseers = overseers;
	}
}
