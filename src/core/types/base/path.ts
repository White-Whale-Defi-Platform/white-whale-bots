import { Pool } from "./pool";

export interface Path {
	pools: Array<Pool>;
	addresses: Set<string>;
	equalpaths: Array<Set<string>>;
	identifier: number;
}
