import { Asset, AssetInfo } from "../base/asset";

export type DefaultSwapMessage = {
	swap: {
		max_spread: string;
		offer_asset: Asset;
		belief_price: string;
	};
};

export type InnerSwapMessage = {
	swap: {
		max_spread: string;
		belief_price: string;
	};
};

export type JunoSwapMessage = {
	swap: {
		input_token: string;
		input_amount: string;
		min_output: string;
	};
};

export type JunoSwapOperationsMessage = {
	pass_through_swap: {
		output_min_token: string;
		input_token: string;
		input_token_amount: string;
		output_amm_address: string;
	};
};

export type WWSwapOperation = {
	terra_swap: {
		offer_asset_info: AssetInfo;
		ask_asset_info: AssetInfo;
	};
};

export type AstroSwapOperation = {
	astro_swap: {
		offer_asset_info: AssetInfo;
		ask_asset_info: AssetInfo;
	};
};
type SwapOperationsInnerMessageOperations =
	| Array<WWSwapOperation>
	| Array<AstroSwapOperation>
	| Array<WyndSwapOperations>;

export type SwapOperationsMessage = {
	execute_swap_operations: SwapOperationsInnerMessage;
};
export type SwapOperationsInnerMessage = {
	max_spread: string;
	minimum_receive: string;
	offer_amount: string;
	operations: SwapOperationsInnerMessageOperations;
};

export type WyndSwapOperations = {
	wyndex_swap: {
		offer_asset_info: { native: string } | { token: string };
		ask_asset_info: { native: string } | { token: string };
	};
};

export type TFMSwapOperationsMessage = {
	execute_swap_operations: {
		routes: [
			{
				operations: Array<{
					t_f_m_swap: {
						factory_name: string;
						pair_contract: string;
						ask_asset_info: AssetInfo;
						offer_asset_info: AssetInfo;
					};
				}>;
				offer_amount: string;
			},
		];
		max_spread: string;
		offer_amount: string;
		expect_amount: string;
		minimum_receive: string;
	};
};

/**
 *
 */
export function isTFMSwapOperationsMessage(msg: any): msg is TFMSwapOperationsMessage {
	if (msg["execute_swap_operations" as keyof typeof msg]) {
		const msg_execute = msg["execute_swap_operations"];
		return msg_execute["routes" as keyof typeof msg_execute] !== undefined;
	} else {
		return false;
	}
}
/**
 * Checks if a provided `msg` is a swap.
 * @param msg The message object to be checked.
 * @return True or false.
 */
export function isSwapMessage(msg: any): boolean {
	return msg["swap" as keyof typeof msg] !== undefined;
}

/**
 * Checks if a provided `msg` is a default swap message.
 * @param msg The message object to be checked.
 * @return SwapMessage if the `msg` is one.
 */
export function isDefaultSwapMessage(msg: any): msg is DefaultSwapMessage {
	return isSwapMessage(msg) && msg.swap["offer_asset" as keyof typeof msg.swap] !== undefined;
}

/**
 * Checks if the provided `msg` is a junoswap message.
 * @param msg The message object to be checked.
 * @return JunoSwapMessage if the `msg` is one.
 */
export function isJunoSwapMessage(msg: any): msg is JunoSwapMessage {
	return (
		msg["swap" as keyof typeof msg] !== undefined && msg.swap["input_token" as keyof typeof msg.swap] !== undefined
	);
}

/**
 *
 */
export function isJunoSwapOperationsMessage(msg: any): msg is JunoSwapOperationsMessage {
	return msg["pass_through_swap" as keyof typeof msg] !== undefined;
}
/**
 * Checks if the provided `msg` is a swap-operations message.
 * @param msg The message object to be checked.
 * @return SwapOperationsMessage if the `msg` is one.
 */
export function isSwapOperationsMessage(msg: any): msg is SwapOperationsMessage {
	return (
		msg["execute_swap_operations" as keyof typeof msg] !== undefined &&
		msg.execute_swap_operations["operations" as keyof typeof msg.execute_swap_operations] !== undefined
	);
}

/**
 * Checks if the provided `msg` is a swap-operations message.
 * @param msg The message object to be checked.
 * @return WWSwapOperations if the `msg` is one.
 */
export function isWWSwapOperationsMessages(msg: SwapOperationsInnerMessageOperations): msg is Array<WWSwapOperation> {
	return msg[0]["terra_swap" as keyof (typeof msg)[0]] !== undefined;
}

/**
 * Checks if the provided `msg` is a swap-operations message.
 * @param msg The message object to be checked.
 * @return WWSwapOperations if the `msg` is one.
 */
export function isAstroSwapOperationsMessages(
	msg: SwapOperationsInnerMessageOperations,
): msg is Array<AstroSwapOperation> {
	return msg[0]["astro_swap" as keyof (typeof msg)[0]] !== undefined;
}

/**
 *
 */
export function isWyndDaoSwapOperationsMessages(
	msg: SwapOperationsInnerMessageOperations,
): msg is Array<WyndSwapOperations> {
	return msg[0]["wyndex_swap" as keyof (typeof msg)[0]] !== undefined;
}
