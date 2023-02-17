import { Pool } from "./pool";

export interface Path {
	pools: Array<Pool>;
	cooldown: boolean;
}
