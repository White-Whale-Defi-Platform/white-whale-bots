import { ChainOperator } from "../../../core/chainOperator/chainoperator";
import { AnchorOverseer, Loan, Loans } from "../../../core/types/base/overseer";

/**
 * Queries all Loans connected to one Overseeraddress.
 */
export async function setLoans(overseer: AnchorOverseer, chainOperator: ChainOperator) {
	const allBorrowers = await getAllBorrowers(overseer, chainOperator);
	const allCollateral = await getAllCollaterals(overseer, chainOperator);
	const allLoans = await getAllLoans(overseer.marketAddress, chainOperator);

	const loans: Loans = {};
	for (const collateral of allCollateral) {
		const ltv = overseer.whitelist.elems.filter((elem) => elem.collateral_token === collateral.collaterals[0][0])[0]
			.max_ltv;
		// const e = allCollaterLs[o];
		if (allBorrowers.has(collateral.borrower)) {
			const loan: Loan = {
				borrowerAddress: collateral.borrower,
				collaterals: {},
				borrowLimit: 0,
				riskRatio: 0,
				loanAmt: 0,
			};
			collateral.collaterals.forEach((elem: [string, string]) => {
				loan.collaterals![elem[0]] = { amount: Number(elem[1]), ltv: +ltv };
			});

			loan.loanAmt = allLoans.get(collateral.borrower) ?? 0;
			loans[collateral.borrower] = loan;
		} else {
			console.log("Borrower not found");
		}
	}
	overseer.loans = loans;
}

/**
 *
 */
async function getAllLoans(marketAddress: string, chainOperator: ChainOperator): Promise<Map<string, number>> {
	let tmploans = await await chainOperator.queryContractSmart(marketAddress, {
		borrower_infos: { limit: 30 },
	});
	let allLoans = tmploans.borrower_infos;
	while (tmploans.borrower_infos.length == 30) {
		tmploans = await await chainOperator.queryContractSmart(marketAddress, {
			borrower_infos: {
				limit: 30,
				start_after: tmploans.borrower_infos[tmploans.borrower_infos.length - 1].borrower,
			},
		});
		allLoans = allLoans.concat(tmploans.borrower_infos);
	}

	const tmpMapLoans: Map<string, number> = new Map();

	allLoans.forEach((elem: any) => tmpMapLoans.set(elem.borrower, Number(elem.loan_amount)));
	return tmpMapLoans;
}

/**
 *
 */
async function getAllCollaterals(
	overseer: AnchorOverseer,
	chainOperator: ChainOperator,
): Promise<CollateralResponse["all_collaterals"]> {
	const collQuery = {
		all_collaterals: { limit: 30 },
	};
	let collateralResponse: CollateralResponse = await chainOperator.queryContractSmart(
		overseer.overseerAddress,
		collQuery,
	);
	const allCollaterals = collateralResponse.all_collaterals;
	let currentCollaterals = collateralResponse.all_collaterals;
	while (currentCollaterals.length === 30) {
		const msg = {
			all_collaterals: {
				limit: 30,
				start_after: currentCollaterals[currentCollaterals.length - 1].borrower,
			},
		};
		collateralResponse = await chainOperator.queryContractSmart(overseer.overseerAddress, msg);
		currentCollaterals = collateralResponse.all_collaterals;
		allCollaterals.push(...currentCollaterals);
	}
	return allCollaterals;
}
/**
 *
 */
async function getAllBorrowers(overseer: AnchorOverseer, chainOperator: ChainOperator): Promise<Map<string, number>> {
	const borrowerList: Map<string, number> = new Map();

	for (const asset of overseer.whitelist.elems) {
		const borrowersResponse: BorrowersResponse = await chainOperator.queryContractSmart(asset.custody_contract, {
			borrowers: { limit: 30 },
		});
		const borrowersCustody = borrowersResponse.borrowers;

		let borrowers = borrowersResponse.borrowers;
		while (borrowers.length === 30) {
			const msg = {
				borrowers: { limit: 30, start_after: borrowers[borrowers.length - 1].borrower },
			};
			const borrowersResponseNext: BorrowersResponse = await chainOperator.queryContractSmart(
				asset.custody_contract,
				msg,
			);
			borrowersCustody.push(...borrowersResponseNext.borrowers);
			borrowers = borrowersResponseNext.borrowers;
		}
		processBorrowers(borrowerList, borrowersCustody);
	}
	return borrowerList;
}
/**
 *
 */
function processBorrowers(borrowerList: Map<string, number>, borrowers: BorrowersResponse["borrowers"]) {
	for (const borrow of borrowers) {
		const existingBorrow = borrowerList.get(borrow.borrower);
		if (existingBorrow === undefined) {
			borrowerList.set(borrow.borrower, Number(borrow.balance) - Number(borrow.spendable));
		} else {
			borrowerList.set(borrow.borrower, existingBorrow + Number(borrow.balance) - Number(borrow.spendable));
		}
	}
}

interface BorrowersResponse {
	borrowers: Array<{
		borrower: string;
		balance: string;
		spendable: string;
	}>;
}
interface CollateralResponse {
	all_collaterals: Array<{
		borrower: string;
		collaterals: Array<[string, string]>;
	}>;
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
