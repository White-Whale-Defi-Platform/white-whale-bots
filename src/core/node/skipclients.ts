import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SkipBundleClient } from "@skip-mev/skipjs";
/**
 *
 */
export interface SkipResult {
	jsonrpc: string;
	id: number;
	result: {
		code: number;
		txs: Array<string>;
		auction_fee: string;
		bundle_size: string;
		desired_height: string;
		waited_for_simulation_results: boolean;
		simulation_success: boolean;
		result_check_txs: Array<any>;
		result_deliver_txs: Array<any>;
		error: string;
	};
}

/**
 *
 */
export async function getSkipClient(
	RPC_URL: string,
	mnemonic: string,
	walletPrefix: string,
): Promise<[SkipBundleClient, DirectSecp256k1HdWallet]> {
	const skipClient = await new SkipBundleClient(RPC_URL);
	const skipSigner = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: walletPrefix });
	return [skipClient, skipSigner];
}
