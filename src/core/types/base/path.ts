import { Pool } from "./pool";

export interface Path {
	pools: Array<Pool>;
	equalpaths: Array<string>;
	identifier: string;
}
