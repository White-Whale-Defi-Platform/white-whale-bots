import { fromBase64, fromUtf8 } from "@cosmjs/encoding";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { ChainOperator } from "../../chainOperator/chainoperator";
import { Mempool } from "./mempool";

export interface Liquidate {
	configs: LiqContractConfig;
	loans: Loans;
	prices: PriceFeeds;
	feeder: Feeder;
	moneymarkets: MMarket;
}

export interface Loans {
	[overseer: string]: Loan;
}

export interface Loan {
	[address: string]: {
		collaterals?: { [address: string]: number | undefined };
		borrowLimit?: number | undefined;
		riskRatio?: number | undefined;
		loanAmt?: number | undefined;
	};
}

export interface PriceFeeds {
	[overseer: string]: PriceFeed;
}

export interface PriceFeed {
	[tokenaddrs: string]: { price: number; custodyAddrs: string; ltv: number };
}

export interface Feeder {
	[feeder: string]: { overseer: string };
}

export interface MMarket {
	[mmarketAddrs: string]: { overseer: string };
}

export interface LiqContractConfig {
	[overseer: string]: {
		oracleContract?: string;
		marketContract?: string;
		liquidationContract?: string;
		priceFeeder?: Array<string>;
	};
}

/**
 * Adds different Overseer and all their needed informations to one Object.
 */
export async function getliqudationinfos(overseer: Array<string>, operator: ChainOperator): Promise<Liquidate> {
	const outLoan: any = {};
	const outPrices: PriceFeeds = {};
	const outConfig: LiqContractConfig = {};
	let outCfgtmp: [LiqContractConfig, Array<string>];
	const outFeeder: Feeder = {};
	const outMMarkets: MMarket = {};

	if (overseer) {
		for (let x = 0; x < overseer.length; x++) {
			outCfgtmp = await getliquidcfg(overseer[x], operator);
			const tmpOutPrices: PriceFeed = await getprice(overseer[x], operator);
			outPrices[overseer[x]] = tmpOutPrices;
			const tmpOutLoan = await queryLoan(
				overseer[x],
				operator,
				outCfgtmp[0][overseer[x]].marketContract!,
				outPrices[overseer[x]],
			);
			outLoan[overseer[x]] = tmpOutLoan[overseer[x]];
			outConfig[overseer[x]] = outCfgtmp[0][overseer[x]];

			outCfgtmp[1].forEach((elem: string) => {
				outFeeder[elem] = { overseer: overseer[x] };
			});
			outMMarkets[outConfig[overseer[x]].marketContract!] = { overseer: overseer[x] };
		}
	}
	await delay(1000);
	const out: Liquidate = {
		configs: outConfig,
		loans: outLoan,
		prices: outPrices,
		feeder: outFeeder,
		moneymarkets: outMMarkets,
	};
	return out;
}

/**
 * Queries all Loans connected to one Overseeraddress.
 */
async function queryLoan(
	overseeraddrs: string,
	client: ChainOperator,
	cfg: string,
	priceFeed: PriceFeed,
): Promise<Loan> {
	const whitelist = {
		whitelist: { limit: 100 },
	};

	const wlist = await client.queryContractSmart(overseeraddrs, whitelist);
	await delay(1000);

	const custodyCon: Array<string> = [];
	if (wlist.elems) {
		wlist.elems.forEach((elem: any) => custodyCon.push(elem.custody_contract));
	}
	const borrower: Map<string, number> = new Map();
	if (custodyCon) {
		for (let u = 0; u < custodyCon.length; u++) {
			let borrowerList: any = [];
			const tmpmsg = {
				borrowers: { limit: 10 },
			};
			let borrowerQ = await client.queryContractSmart(custodyCon[u], tmpmsg);
			borrowerList = borrowerQ.borrowers;
			if (borrowerList.length == 10) {
				let tmp: Array<any> = borrowerList;
				while (borrowerList.length == 10) {
					const msg = {
						borrowers: { limit: 10, start_after: borrowerList[borrowerList.length - 1].borrower },
					};
					borrowerQ = await client.queryContractSmart(custodyCon[u], msg);
					borrowerList = borrowerQ.borrowers;
					tmp = tmp.concat(borrowerQ.borrowers);
				}
				borrowerList = tmp;
			}
			await delay(1000);

			borrowerList.forEach((elem: any) => {
				if (!borrower.has(elem["borrower"])) {
					borrower.set(elem["borrower"], Number(elem["balance"]) - Number(elem["spendable"]));
				} else {
					if (borrower.get(elem["borrower"])) {
						let tmp: any = borrower.get(elem["borrower"]);
						tmp = tmp + Number(elem["balance"]) - Number(elem["spendable"]);
						borrower.set(elem["borrower"], tmp);
					}
				}
			});
		}
	}
	const collQuery = {
		all_collaterals: { limit: 10 },
	};
	const out: Loans = { [overseeraddrs]: {} };
	let collaterLs = await client.queryContractSmart(overseeraddrs, collQuery);
	let allCollaterLs = collaterLs.all_collaterals;
	await delay(1000);
	while (collaterLs.all_collaterals.length == 10) {
		const msg = {
			all_collaterals: {
				limit: 10,
				start_after: collaterLs.all_collaterals[collaterLs.all_collaterals.length - 1].borrower,
			},
		};
		collaterLs = await client.queryContractSmart(overseeraddrs, msg);
		allCollaterLs = allCollaterLs.concat(collaterLs.all_collaterals);
		await delay(500);
	}

	let tmploans = await await client.queryContractSmart(cfg, {
		borrower_infos: { limit: 10 },
	});
	let allLoans = tmploans.borrower_infos;
	while (tmploans.borrower_infos.length == 10) {
		tmploans = await await client.queryContractSmart(cfg, {
			borrower_infos: {
				limit: 10,
				start_after: tmploans.borrower_infos[tmploans.borrower_infos.length - 1].borrower,
			},
		});
		allLoans = allLoans.concat(tmploans.borrower_infos);
		await delay(500);
	}

	const tmpMapLoans: Map<string, number> = new Map();

	allLoans.forEach((elem: any) => tmpMapLoans.set(elem.borrower, Number(elem.loan_amount)));

	if (collaterLs) {
		for (let o = 0; o < allCollaterLs.length; o++) {
			const e = allCollaterLs[o];
			if (borrower.has(e.borrower)) {
				out[overseeraddrs][e.borrower] = {
					collaterals: {},
					borrowLimit: 0,
					riskRatio: 0,
					loanAmt: 0,
				};
				e.collaterals.forEach(
					(elem: [string, string]) =>
						(out[overseeraddrs][e.borrower].collaterals![elem[0]] = Number(elem[1])),
				);

				const lmt = calcBLfromCollaterals(out[overseeraddrs], e.borrower, priceFeed);
				if (tmpMapLoans.has(e.borrower)) {
					out[overseeraddrs][e.borrower].borrowLimit = Number(lmt);
					if (tmpMapLoans.get(e.borrower)) {
						out[overseeraddrs][e.borrower].loanAmt = tmpMapLoans.get(e.borrower);
					} else {
						out[overseeraddrs][e.borrower].loanAmt = 0;
					}
					out[overseeraddrs][e.borrower].riskRatio =
						out[overseeraddrs][e.borrower].loanAmt! / out[overseeraddrs][e.borrower].borrowLimit!;
				}
			} else {
				console.log("Borrower not found");
			}
		}
	}
	return out;
}

/**
 * Queries all addresses connected to an overseer contract.
 */
async function getliquidcfg(overseer: string, operator: ChainOperator): Promise<[LiqContractConfig, Array<string>]> {
	const out: LiqContractConfig = { [overseer]: {} };
	let arrFeeder: Array<string> = [];
	const cfg = await operator.queryContractSmart(overseer, { config: { limit: 100 } });
	await delay(5000);
	if (cfg) {
		out[overseer].oracleContract = cfg.oracle_contract;
		out[overseer].marketContract = cfg.market_contract;
		out[overseer].liquidationContract = cfg.liquidation_contract;
		const whitelist = await operator.queryContractSmart(overseer, { whitelist: { limit: 100 } });
		await delay(2000);
		const tmpFeeder: Set<string> = new Set();

		for (let x = 0; x < whitelist.elems.length; x++) {
			const query = await operator.queryContractSmart(out[overseer].oracleContract!, {
				feeder: { asset: whitelist.elems[x].collateral_token },
			});
			await delay(2000);
			tmpFeeder.add(query.feeder);
		}
		arrFeeder = Array.from(tmpFeeder);
		out[overseer].priceFeeder = arrFeeder;
	}
	return [out, arrFeeder];
}

/**
 * Queries all Prices of an Oracle.
 */
async function getprice(overseer: string, operator: ChainOperator): Promise<PriceFeed> {
	const whitelist = {
		whitelist: { limit: 100 },
	};
	const configq = {
		config: { limit: 100 },
	};
	const priceq = {
		prices: { limit: 100 },
	};
	const wlist = await operator.queryContractSmart(overseer, whitelist);
	await delay(1000);

	const custodyCon: Map<string, [string, number]> = new Map();
	if (wlist.elems) {
		wlist.elems.forEach((elem: any) =>
			custodyCon.set(elem.collateral_token, [elem.custody_contract, Number(elem.max_ltv)]),
		);
	}

	const req = await operator.queryContractSmart(overseer, configq);
	await delay(1000);
	const priceFeedAddrs = req.oracle_contract;
	const pricesLs = await operator.queryContractSmart(priceFeedAddrs, priceq);

	const prices: PriceFeed = {};

	pricesLs.prices.forEach((elem: any) => {
		const tmp21 = custodyCon.get(elem.asset);
		const custody = tmp21?.[0];
		const ltv = tmp21?.[1];
		if (custodyCon.has(elem.asset) && custody && ltv) {
			prices[elem.asset] = { price: Number(elem.price), custodyAddrs: custody, ltv: ltv };
		}
	});
	return prices;
}

let txMemoryLiq: { [key: string]: boolean } = {};

/**
 * Flushes the already processed transactions from the mempool.
 */
export function flushTxMemoryLiq() {
	txMemoryLiq = {};
}

/**
 * Process MsgExecuteContract if Collateral Amount, Loan or Prices changed.
 * Returns [0]: Array of Overseer Addresses that got new Prices through Oracles.
 * Returns [1]: Array of changes if someone interacted with the overseer or the moneymarket.
 */
export async function processMempoolLiquidation(
	mempool: Mempool,
	liquidate: Liquidate,
): Promise<[Array<string>, Array<{ overseer: string; address: string; message: any }>]> {
	const liqChanges: [Array<string>, Array<{ overseer: string; address: string; message: any }>] = [[], []];

	for (const tx of mempool.txs) {
		if (txMemoryLiq[tx] == true) {
			// the transaction is already processed and stored in the txMemoryLiq
			continue;
		}
		// set the transaction to processed in the txMemoryLiq
		txMemoryLiq[tx] = true;
		// decode transaction to readable object
		const txBytes = fromBase64(tx);
		const txRaw = decodeTxRaw(txBytes);
		for (const message of txRaw.body.messages) {
			let msgExecuteContract: MsgExecuteContract;
			let containedMsg;
			if (message.typeUrl === "/cosmwasm.wasm.v1.MsgExecuteContract") {
				msgExecuteContract = MsgExecuteContract.decode(message.value);
				containedMsg = JSON.parse(fromUtf8(msgExecuteContract.msg));
			} else {
				continue;
			}

			if (liquidate.feeder[msgExecuteContract.sender]) {
				const feed = processPriceFeed(
					containedMsg,
					liquidate.prices[liquidate.feeder[msgExecuteContract.sender].overseer],
				);
				liquidate.prices[liquidate.feeder[msgExecuteContract.sender].overseer] = feed;
				if (!liqChanges[0].includes(liquidate.feeder[msgExecuteContract.sender].overseer)) {
					liqChanges[0].push(liquidate.feeder[msgExecuteContract.sender].overseer);
				}
			} else if (liquidate.prices[msgExecuteContract.contract]) {
				liqChanges[1].push({
					overseer: msgExecuteContract.contract,
					address: msgExecuteContract.sender,
					message: containedMsg,
				});
			} else if (liquidate.moneymarkets[msgExecuteContract.contract]) {
				liqChanges[1].push({
					overseer: liquidate.moneymarkets[msgExecuteContract.contract].overseer,
					address: msgExecuteContract.sender,
					message: containedMsg,
				});
			} else {
				continue;
			}
		}
	}
	return liqChanges;
}

/**
 * Updates Borrow Limits if new prices were recieved, adds/removes collateral, adds/updates loans.
 * Returns [0]: Addresses to liquidate.
 * Returns [1]: Loans that need to be added/updated via query.
 */
export async function processLiquidate(
	loansObj: Loans,
	priceFeeds: PriceFeeds,
	mempooltxs: [Array<string>, Array<{ overseer: string; address: string; message: any }>],
): Promise<
	[
		Array<{
			overseer: string;
			address: string;
		}>,

		Array<{
			overseer: string;
			address: string;
		}>,
	]
> {
	const newLoans = new Set<{ overseer: string; address: string }>();
	let toLiq: Array<{
		overseer: string;
		address: string;
	}> = [];
	if (mempooltxs[0].length > 0) {
		toLiq = updateBorrowLimits(priceFeeds, loansObj);
	}

	if (mempooltxs[1].length > 0) {
		for (let i = 0; i < mempooltxs[1].length; i++) {
			try {
				if (mempooltxs[1][i].message.lock_collateral) {
					for (let z = 0; z < mempooltxs[1][i].message.lock_collateral.collaterals.length; z++) {
						const elem = mempooltxs[1][i].message.lock_collateral.collaterals[z];
						if (loansObj[mempooltxs[1][i].overseer][mempooltxs[1][i].address]) {
							if (loansObj[mempooltxs[1][i].overseer][mempooltxs[1][i].address].collaterals![elem[0]]) {
								addCollateral(loansObj, mempooltxs[1][i].overseer, mempooltxs[1][i].address, elem);
							}
						} else {
							newLoans.add({ overseer: mempooltxs[1][i].overseer, address: mempooltxs[1][i].address });
							console.log("new Loan: " + mempooltxs[1][i]);
						}
					}
				} else if (mempooltxs[1][i].message.unlock_collateral) {
					for (let z = 0; z < mempooltxs[1][i].message.unlock_collateral.collaterals.length; z++) {
						const elem = mempooltxs[1][i].message.unlock_collateral.collaterals[z];
						if (loansObj[mempooltxs[1][i].overseer][mempooltxs[1][i].address]) {
							if (loansObj[mempooltxs[1][i].overseer][mempooltxs[1][i].address].collaterals![elem[0]]) {
								removeCollateral(loansObj, mempooltxs[1][i].overseer, mempooltxs[1][i].address, elem);
							}
						} else {
							newLoans.add({ overseer: mempooltxs[1][i].overseer, address: mempooltxs[1][i].address });
							console.log("new Loan: " + mempooltxs[1][i]);
						}
					}
				} else if (mempooltxs[1][i].message.repay_stable || mempooltxs[1][i].message.send) {
					newLoans.add({ overseer: mempooltxs[1][i].overseer, address: mempooltxs[1][i].address });
				}
			} catch (e) {
				console.log(e);
				newLoans.add({ overseer: mempooltxs[1][i].overseer, address: mempooltxs[1][i].address });
				console.log("error in adding/removing funds:");
				console.log(typeof mempooltxs[1][i].message);
				console.log(JSON.stringify(mempooltxs[1][i].message));
			}
		}
	}
	return [toLiq, [...newLoans]];
}

/**
 * Sets all needed informations to add/update the Loan of an address.
 */
export async function addNewBorrower(
	newLoans: Array<{
		overseer: string;
		address: string;
	}>,
	liqObj: Liquidate,
	operator: ChainOperator,
) {
	if (newLoans.length > 0) {
		//const newLoans = Object.keys(newLoans)
		for (let x = 0; x < newLoans.length; x++) {
			try {
				const loan_query = await operator.queryContractSmart(
					liqObj.configs[newLoans[x].overseer].marketContract!,
					{
						borrower_info: { borrower: newLoans[x].address },
					},
				);
				const collQuery = await operator.queryContractSmart(newLoans[x].overseer, {
					collaterals: { borrower: newLoans[x].address },
				});
				const collateral = collQuery.collaterals;
				const loanmt = loan_query.loan_amount;

				addNewLoan(
					liqObj.loans,
					newLoans[x].overseer,
					newLoans[x].address,
					collateral,
					liqObj.prices[newLoans[x].overseer],
					Number(loanmt),
				);
			} catch (e) {
				console.log(e);
				console.log(newLoans[x]);
			}
		}
	}
}

/**
 * Adds the new Loan, overwrites old state if availiable.
 */
function addNewLoan(
	loansObj: Loans,
	overseer: string,
	address: string,
	collateral: Array<[string, string | number]>,
	prices: PriceFeed,
	loan_amount: number,
) {
	if (loansObj[overseer][address]) {
		delete loansObj[overseer][address];
	}
	loansObj[overseer][address] = {
		collaterals: {},
		borrowLimit: 0,
		riskRatio: 0,
		loanAmt: loan_amount,
	};
	let tmp_borrowLimit = 0;
	collateral.forEach((elem) => {
		loansObj[overseer][address].collaterals![elem[0]] = Number(elem[1]);
		tmp_borrowLimit = Math.floor(Number(elem[1]) * prices[elem[0]].price * prices[elem[0]].ltv) + tmp_borrowLimit;
	});
	loansObj[overseer][address].borrowLimit = tmp_borrowLimit;
	loansObj[overseer][address].loanAmt = loan_amount;
	loansObj[overseer][address].riskRatio =
		loansObj[overseer][address].loanAmt! / loansObj[overseer][address].borrowLimit!;

	console.log("added/updated Loan: " + JSON.stringify(loansObj[overseer][address]!));
}

/**
 * Adds collateral by token address.
 */
function addCollateral(
	loansObj: Loans,
	overseer: string,
	address: string,
	toAdd: [collateral: string, amount: string],
): void {
	if (loansObj[overseer][address].collaterals) {
		if (loansObj[overseer][address].collaterals![toAdd[0]]) {
			loansObj[overseer][address].collaterals![toAdd[0]] =
				loansObj[overseer][address].collaterals![toAdd[0]]! + Number(toAdd[1]);
		} else {
			loansObj[overseer][address].collaterals![toAdd[0]] = Number(toAdd[1]);
		}
	}
}

/**
 * Removes collateral by token address.
 */
function removeCollateral(
	loansObj: Loans,
	overseer: string,
	address: string,
	toRemove: [collateral: string, amount: string],
): boolean {
	if (loansObj[overseer][address].collaterals) {
		loansObj[overseer][address].collaterals![toRemove[0]] =
			loansObj[overseer][address].collaterals![toRemove[0]]! - Number(toRemove[1]);
		return true;
	}
	return false;
}

/**
 * Calculate the Borrow Limit and the Risk-Score of a Loan.
 * Calculates if liquidation is possible.
 */
function updateBorrowLimits(priceFeeds: PriceFeeds, loansObj: Loans) {
	const out: Array<{ overseer: string; address: string }> = [];
	if (loansObj) {
		const iter = Object.keys(loansObj);
		for (let i = 0; i < iter.length; i++) {
			const loansOfOverseer = Object.keys(loansObj[iter[i]]);
			for (let y = 0; y < loansOfOverseer.length; y++) {
				const limittmp = calcBLfromCollaterals(loansObj[iter[i]], loansOfOverseer[y], priceFeeds[iter[i]]);
				loansObj[iter[i]][loansOfOverseer[y]].borrowLimit = limittmp;
				const score =
					loansObj[iter[i]][loansOfOverseer[y]].loanAmt! / loansObj[iter[i]][loansOfOverseer[y]].borrowLimit!;
				loansObj[iter[i]][loansOfOverseer[y]].riskRatio = score;
				if (score >= 1) {
					out.push({ overseer: iter[i], address: loansOfOverseer[y] });
				} else if (score > 0.989) {
					console.log(
						"Address: " +
							loansOfOverseer[y] +
							" " +
							String(score) +
							" Borrow Limit: " +
							String(loansObj[iter[i]][loansOfOverseer[y]].borrowLimit!) +
							" Loan: " +
							String(loansObj[iter[i]][loansOfOverseer[y]].loanAmt!),
					);
				}
			}
		}
	}
	return out;
}
/**
 *
 */
function calcBLfromCollaterals(loan: Loan, borrower: string, priceFeed: PriceFeed) {
	if (loan[borrower].collaterals) {
		let outLimit = 0;
		const collateralIter = Object.keys(loan[borrower].collaterals!);
		for (let i = 0; i < collateralIter.length; i++) {
			if (priceFeed[collateralIter[i]]) {
				outLimit =
					outLimit +
					loan[borrower].collaterals![collateralIter[i]]! *
						priceFeed[collateralIter[i]].price *
						priceFeed[collateralIter[i]].ltv;
			}
		}
		return Math.floor(outLimit);
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
