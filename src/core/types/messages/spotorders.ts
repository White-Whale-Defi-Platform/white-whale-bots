import { OrderType } from "@injectivelabs/sdk-ts/";

/* order types:
  UNSPECIFIED: 0;
  BUY: 1;
  SELL: 2;
  STOP_BUY: 3;
  STOP_SELL: 4;
  TAKE_BUY: 5;
  TAKE_SELL: 6;
  BUY_PO: 7;
  SELL_PO: 8;
  BUY_ATOMIC: 9;
  SELL_ATOMIC: 10;
*/
export declare type SpotMarketOrderMessage = {
	marketId: string;
	subaccountId: string;
	injectiveAddress: string;
	orderType: OrderType;
	triggerPrice?: string;
	feeRecipient: string;
	price: string;
	quantity: string;
};
