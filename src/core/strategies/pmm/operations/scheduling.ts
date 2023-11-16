import { EventEmitter } from "events";

import { PMMLoop } from "../loops/pmmloop";

/**
 *
 */
export default class Scheduler extends EventEmitter {
	/**
	 *
	 */
	constructor() {
		super();
	}

	/**
	 *
	 */
	public startLogTimer(interval: number, loop: PMMLoop): void {
		setInterval(() => {
			this.emit("logTrigger", loop, new Date());
		}, interval);
	}
	/**
	 *
	 */
	public startOrderUpdates(interval: number): void {
		setInterval(() => {
			this.emit("updateOrders", { time: new Date() });
		}, interval);
	}
}
