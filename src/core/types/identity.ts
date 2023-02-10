/**
 * Enforces the type of an item.
 * @param item The item to enforce the type of.
 * @returns The item passed.
 */
export function identity<T>(item: T): T {
	return item;
}
