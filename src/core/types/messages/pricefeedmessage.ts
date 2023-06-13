export interface PriceFeedMessage {
	feed_price: {
		prices: Array<[string, string]>;
	};
}
