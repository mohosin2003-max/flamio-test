# Owner Finance & Profit Partners

## What I found (inspection)

- **Staff salary**: `staff_salary_profiles` (monthly/daily rate, overtime, payday) + `staff_ledger_entries` (salary_payment, advance, loan, bonus, deduction, overtime, money-taken with pending/approved/rejected) + `staff_ledger_audit`. Owner UI: Staff accounts & payroll page. Staff UI: "My salary & money" page, fed by one server function that reads only the signed-in person's rows.
- **Authoritative profit**: the owner Sales report — completed-order revenue minus purchases in the period. That is the only profit calculation in the app, and it will be reused unchanged.
- **Permissions**: one catalogue with per-person No access / View only / Full access, enforced server-side. Salary/money already has `Own Salary` and `Own Money-Taken` keys, and `Staff Accounts` for owner payroll.
- **Roles**: owner/admin/staff rows; owner is always full access.

Nothing above gets rebuilt; everything new plugs into it.

## What will be built

### 1. Owner: My salary → Owner Finance
- Owner no longer sees "My salary & money" anywhere (staff and managers keep it exactly as now).
- New owner-only **Owner Finance** page showing, for the selected month and all time: business profit, owner withdrawals, profit retained, plus a dated withdrawal history.
- Profit comes from the existing report calculation. Withdrawals are shown as a separate layer and never subtracted from it as an expense.

### 2. Owner profit withdrawals
- Record amount, date, time, reason, note, payment method, month, and who recorded it.
- Classified strictly as owner profit withdrawal — separate from salary, advances, purchases and staff money-taken.

### 3. Profit partners (inside existing staff management)
- An existing staff/manager can be marked a partner by the owner: enabled/disabled, share percentage, effective-from month, optional end.
- Compensation type per person: Salary (unchanged behaviour) or Profit Share.
- Each change writes a **new effective-dated row**, so past months keep the percentage they had. Disabling stops future earnings and keeps history.
- No earnings exist for months before the effective-from month.

### 4. Partner's own view
- A partner sees "My profit share" in place of "My salary": month's business profit basis, their %, earned, paid, remaining, plus totals and month-by-month history — their own data only.

### 5. Owner partner management
- List of partners with status, %, effective from, this month's earned/paid/remaining and all-time totals.
- Actions: enable/disable, set future %, set effective-from, record a partner payment, view history. A payment lowers remaining and never changes earned.

### 6. Permissions & privacy
- New keys: **Own Profit Share** (staff-facing) and reuse of the owner-only Staff Accounts area for partner management and payments; no duplicate permission system.
- Partners cannot read other partners, staff salaries, staff money-taken, or owner withdrawals — enforced in the server functions and in table security rules, not just hidden in the UI.

## Technical notes

- New SQL file `docs/sql/owner_finance_partners.sql` (additive only, you run it once in Supabase): `owner_withdrawals`, `profit_partner_terms` (effective-dated), `partner_payments`, and a `compensation_type` column on `staff_salary_profiles` defaulting to `salary`. Grants + RLS: owner/admin full, partner SELECT only on own `profit_partner_terms`/`partner_payments` rows, no anon access. No drops, no data changes.
- New `src/lib/owner-finance.functions.ts` + `owner-finance.server.ts`: a shared `netProfitForRange()` helper that uses the existing completed-revenue-minus-purchases formula (extracted, not duplicated), owner CRUD for withdrawals/terms/payments behind `assertOwner`, and `staffGetMyProfitShare` behind the new own-permission returning only the caller's months.
- New route `src/routes/_authenticated/owner.finance.tsx`; partner management rendered as a section of the existing staff-accounts page. Existing cards/dialog/table patterns reused.
- Edits limited to: `permissions.ts` (one new key), `owner.tsx` route map, `owner.index.tsx` + `owner.account.tsx` (owner sees Owner Finance instead of My salary), `owner.my-account.tsx` (profit-share variant), staff editor for compensation/partner config.

## Verification

Staff and manager salary untouched; owner sees Owner Finance and no My Salary; withdrawal appears in history and does not change profit; partner sees only own data; no pre-effective-date earnings; old months keep old %; payment raises paid and lowers remaining; disabling stops future only; POS/orders/kitchen/inventory/auth unaffected.
