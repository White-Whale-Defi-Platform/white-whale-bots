import { EventEmitter } from "events";

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
	public startLogTimer(interval: number): void {
		setInterval(() => {
			this.emit("logTrigger", new Date());
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
