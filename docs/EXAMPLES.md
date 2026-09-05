# Example conversations

Gold User / Assistant outcomes for a group-treasury user (Reliance-like finance team). Every figure is computed from the `SCHEMA.md` sample seed: 10 accounts, 10 transactions. Schema is not extended.

**As of:** 5 Sep 2026  
**Currency:** INR  
**Fiscal year:** Indian FY, April to March  
**Cash position:** sum of `account.available_balance` (current snapshot)  
**Period movement:** credits minus debits in the date window  
**Vendor names:** alias match on `transaction.description`  
**Bare "ref no":** `transaction_reference_id` only  
**Account numbers:** masked (`HDFC 5020****9069`)  
**UTR:** never printed

Locked product calls used in these answers:

- One group-treasury view across all accounts. `entity_id` is not treated as a named subsidiary until a dictionary exists.
- `program_id` is shown as a raw code (21, 04, 46).
- Official reconciliation, budget vs actual, P&L, and historical cash are refused.
- Missing reference is offered only as a labeled proxy, never as "unreconciled."
- Empty windows are stated as empty. No invented totals.

When the 20M-row set arrives, keep these shapes. Only the row counts and amounts change.

---

## 1. Cash position by bank

**User:** What is our cash position across banks right now?

**Assistant:**

Net available cash across 10 accounts is **INR -8,12,29,672.84**. This is the live snapshot on the account rows, not a sum of transactions.

Axis holds most of the surplus. HDFC and ICICI are deeply negative and more than offset it.

| Bank | Accounts | Available balance (INR) |
|---|---:|---:|
| AXIS BANK LIMITED | 1 | 23,16,80,596.77 |
| UNION BANK OF INDIA | 1 | 4,08,42,693.08 |
| KOTAK MAHINDRA BANK LIMITED | 1 | 86,95,000.75 |
| CANARA BANK | 1 | 38,87,946.81 |
| STATE BANK OF INDIA | 2 | 33,87,800.43 |
| ICICI BANK LIMITED | 1 | -11,74,20,771.35 |
| HDFC BANK LIMITED | 3 | -25,23,02,939.33 |
| **Total** | **10** | **-8,12,29,672.84** |

How this was produced: template `cash_position`, grouped by `bank_code`. No date filter. Balances taken from `account.available_balance`. AU Small Finance, Tamilnad Mercantile, and RBL have no accounts in this dataset.

---

## 2. Empty window (last month)

**User:** How much did we spend last month?

**Assistant:**

I do not have any debit transactions in **August 2026** (1 Aug 2026 to 31 Aug 2026). Last month's spend is not a number I can invent.

The latest debits in the dataset are in **June 2026** (INR 1,69,299.00 across 4 rows). Ask for June, Q1 FY26-27, or FY26-27 year to date if you want a computed total.

How this was produced: template `period_spend`, `transaction_type = debit`, date bounds 2026-08-01 to 2026-08-31. Row count: 0. Calendar: last month relative to 5 Sep 2026.

---

## 3. Period spend + compare (multi-turn)

**User:** How much did we spend in June?

**Assistant:**

June 2026 outflow is **INR 1,69,299.00** across 4 debits. All of it sat on one HDFC account (`HDFC 5020****9069`, program 21). There were no credits that month, so net movement is **-1,69,299.00**.

| Date | Bank / account | Counterparty (from description) | Amount (INR) | Ref |
|---|---|---|---:|---|
| 24 Jun 2026 06:30 | HDFC 5020****9069 | Selection Mobile | 66,899.00 | HDFCH01078324740 |
| 24 Jun 2026 06:39 | HDFC 5020****9069 | Umang Selection, Hapur | 7,959.00 | HDFCH01078329532 |
| 24 Jun 2026 06:56 | HDFC 5020****9069 | Selection Mobile | 79,575.00 | HDFCH01078342174 |
| 24 Jun 2026 18:24 | HDFC 5020****9069 | Selection Electronics, Dahisar East | 14,866.00 | 1715499972 |
| **Total** | | | **1,69,299.00** | |

How this was produced: template `period_spend`, `transaction_type = debit`, date bounds 2026-06-01 to 2026-06-30. Row count: 4. FY calendar not required for a named month.

**User:** How does that compare to the month before?

**Assistant:**

June was **INR 98,143.00 higher** than May. May 2026 outflow was **INR 71,156.00** (2 debits). June was **INR 1,69,299.00** (4 debits). Both months had zero credits.

| Period | Debits | Outflow (INR) | Inflow (INR) | Net movement (INR) |
|---|---:|---:|---:|---:|
| May 2026 | 2 | 71,156.00 | 0.00 | -71,156.00 |
| June 2026 | 4 | 1,69,299.00 | 0.00 | -1,69,299.00 |
| **Change** | **+2** | **+98,143.00** | **0.00** | **-98,143.00** |

May rows, for the check:

| Date | Bank / account | Counterparty | Amount (INR) | Ref |
|---|---|---|---:|---|
| 14 May 2026 11:31 | HDFC 5020****4137 | Navyug Selection | 50,000.00 | 103293775381 |
| 20 May 2026 09:49 | HDFC 5020****4137 | Reliance Digital Retail Ltd, Select City Saket | 21,156.00 | 1643797818 |

How this was produced: template `compare_period`, reused June filters, shifted to 2026-05-01 to 2026-05-30. This is period movement, not a change in available balance.

---

## 4. Vendor spend (clear alias)

**User:** How much did we pay Selection Mobile in June?

**Assistant:**

**INR 1,46,474.00** to Selection Mobile in June 2026, from 2 NEFT debits on `HDFC 5020****9069`. Match confidence is high: both descriptions contain `SELECTION MOBILE` and the same beneficiary pattern (`ICIC0001241`, account `124105002702`).

| Date | Description (trimmed) | Amount (INR) | Ref |
|---|---|---:|---|
| 24 Jun 2026 06:30 | NEFT - ICIC0001241 - SELECTION MOBILE | 66,899.00 | HDFCH01078324740 |
| 24 Jun 2026 06:56 | NEFT - ICIC0001241 - SELECTION MOBILE | 79,575.00 | HDFCH01078342174 |
| **Total** | | **1,46,474.00** | |

That is 86.5% of June outflow (1,46,474.00 of 1,69,299.00). The 79,575.00 leg is the larger of the two and is large relative to the other June payouts on this account.

How this was produced: template `period_spend`, description alias `selection_mobile`, date bounds 2026-06-01 to 2026-06-30, `transaction_type = debit`. Row count: 2.

---

## 5. Ambiguous vendor (clarify, do not guess)

**User:** How much did we pay Selection last quarter?

**Assistant:**

I will not pick a single "Selection" vendor. In **Q1 FY26-27 (1 Apr 2026 to 30 Jun 2026)** the word hits four different counterparties. Say which one, or say "all of these."

| Counterparty alias | Debits | Outflow (INR) | Share of Q1 spend |
|---|---:|---:|---:|
| Selection Mobile | 2 | 1,46,474.00 | 60.9% |
| Navyug Selection | 1 | 50,000.00 | 20.8% |
| Selection Electronics, Dahisar East | 1 | 14,866.00 | 6.2% |
| Umang Selection, Hapur | 1 | 7,959.00 | 3.3% |
| **If you mean all of the above** | **5** | **2,19,299.00** | **91.2% of Q1 spend** |

Q1 FY26-27 total outflow was **INR 2,40,455.00** (6 debits). The remaining 21,156.00 is Reliance Digital Retail Ltd, which I did not treat as "Selection."

Selectricity Two Pvt Ltd and Selection Maligai appear in the dataset as **credits** in FY25-26, so they are not in this quarter's spend.

How this was produced: template `clarify_counterparty`, FY Q1 2026-27, description token `SELECTION`. No single total was returned.

---

## 6. Named brand in a messy description

**User:** What did we spend on Reliance Digital this year?

**Assistant:**

In **FY26-27 year to date (1 Apr 2026 to 5 Sep 2026)** there is **one** debit matching Reliance Digital: **INR 21,156.00** on 20 May 2026.

| Date | Bank / account | Description (trimmed) | Amount (INR) | Ref |
|---|---|---|---:|---|
| 20 May 2026 09:49 | HDFC 5020****4137 | FT RELIANCEDIGITAL RETAIL LTD SELECT CITY SAKET DELHI | 21,156.00 | 1643797818 |

Match confidence is high (`RELIANCEDIGITAL RETAIL LTD`). This is bank-statement text, not a vendor master. I cannot tell store vs legal entity beyond what the description says.

How this was produced: template `period_spend`, alias `reliance_digital`, FY26-27 YTD, `transaction_type = debit`. Row count: 1.

---

## 7. Reference lookup

**User:** Pull up ref HDFCH01078329532. Who did we pay?

**Assistant:**

That reference is a **debit of INR 7,959.00** on 24 Jun 2026 06:39:10 from `HDFC 5020****9069` (program 21).

| Field | Value |
|---|---|
| Amount | INR 7,959.00 debit |
| When | 24 Jun 2026 06:39:10 |
| Account | HDFC 5020****9069 |
| Counterparty (from description) | Umang Selection, Hapur |
| Description | NEFT - UTIB0002678 - 95604250 - 915020031685136 - UMANG SELECTIONHAPURBPES DPF10129 |
| Ref | HDFCH01078329532 |
| UTR | present, masked |

How this was produced: template `lookup_reference` on `transaction_reference_id = HDFCH01078329532`. Row count: 1. UTR was not searched and is not shown.

---

## 8. Inflow vs outflow for the quarter

**User:** Give me inflow vs outflow for this quarter.

**Assistant:**

**This quarter** is **Q2 FY26-27 (1 Jul 2026 to 30 Sep 2026)**. I have **no transactions** in that window as of 5 Sep 2026, so inflow, outflow, and net are all empty, not zero-from-guesswork.

If you meant **Q1 FY26-27 (1 Apr 2026 to 30 Jun 2026)**, that window does have data:

| | INR | Rows |
|---|---:|---:|
| Inflow (credits) | 0.00 | 0 |
| Outflow (debits) | 2,40,455.00 | 6 |
| **Net movement** | **-2,40,455.00** | **6** |

That net movement is not a change in available cash. Available cash is the snapshot in example 1.

How this was produced: template `inflow_outflow`. First pass used Q2 FY26-27 (row count 0). The Q1 table is the nearest window that has rows. Say if you want Q1 treated as the answer of record.

---

## 9. Top counterparties (insight)

**User:** Who are we paying the most, year to date?

**Assistant:**

FY26-27 YTD (1 Apr 2026 to 5 Sep 2026) outflow is **INR 2,40,455.00** across 6 debits. There are no YTD credits. Concentration is high: the top two aliases are **81.7%** of spend.

| Rank | Counterparty alias | Debits | Outflow (INR) | Share |
|---|---|---:|---:|---:|
| 1 | Selection Mobile | 2 | 1,46,474.00 | 60.9% |
| 2 | Navyug Selection | 1 | 50,000.00 | 20.8% |
| 3 | Reliance Digital Retail Ltd | 1 | 21,156.00 | 8.8% |
| 4 | Selection Electronics, Dahisar East | 1 | 14,866.00 | 6.2% |
| 5 | Umang Selection, Hapur | 1 | 7,959.00 | 3.3% |

Aliases are parsed from `description`. Two Selection Mobile NEFTs on the same day look like a split payout to one beneficiary, not two vendors.

How this was produced: template `counterparty_breakdown`, FY26-27 YTD, `transaction_type = debit`, grouped by alias. Row count: 6.

---

## 10. Official recon (refuse) + labeled proxy

**User:** Which transactions are still unreconciled?

**Assistant:**

I cannot answer that. This dataset has **no reconciliation status**, no invoice table, and no matcher against a ledger. Saying a row is unreconciled would be an invented status.

What I can show, if useful as a **proxy only**: transactions with a **missing reference number**. That is not the same as unreconciled.

| Date | Bank / account | Description (trimmed) | Amount (INR) | Ref | UTR |
|---|---|---|---:|---|---|
| 17 Mar 2026 14:53 | SBIN 9010****4321 | IMPS OW Gautam singh | 110.00 debit | missing | missing |

Row count for missing `transaction_reference_id`: 1. Several other rows have a reference but a missing UTR. I did not treat those as unreconciled either.

How this was produced: refuse on `reconciliation_status` (column does not exist). Optional proxy template `missing_reference` run only as a labeled alternative.

---

## 11. Historical cash (refuse)

**User:** What was our cash position last Friday?

**Assistant:**

I cannot reconstruct cash as of 4 Sep 2026. `available_balance` is a **current snapshot** only. There is no running-balance history on the transaction rows.

What I can do instead:

- Current cash by bank: **INR -8,12,29,672.84** (example 1)
- Movement in a date window, for example June 2026 net **-1,69,299.00** (example 3)

How this was produced: refuse on `cash_as_of`. No figure was computed for 4 Sep 2026.

---

## 12. Budget vs actual (refuse)

**User:** How are we tracking against budget on vendor payouts this quarter?

**Assistant:**

I cannot do budget vs actual. There is no budget, no chart of accounts, and no vendor master in this schema. I only see bank transactions.

Nearest grounded views: Q1 FY26-27 outflow **INR 2,40,455.00**, or the Selection Mobile June total **INR 1,46,474.00**. Those are actuals only.

How this was produced: refuse on `budget_vs_actual`. Columns required for a budget variance do not exist.
