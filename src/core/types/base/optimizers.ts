import { DexConfig } from "./configs";

export interface OptimizerInterface<T, V> {
	(paths: Array<T>, botConfig: DexConfig): V | undefined;
}
