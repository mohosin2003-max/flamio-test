# Staff Accounts & Financial Ledger

Add a money ledger for each team member — salary setup, payments, advances, loans, repayments, bonuses, deductions and overtime — as a new section in the Owner dashboard. Nothing that exists today changes behaviour.

## What already exists (reusable)

- **Staff records**: team members live in the roles table and are listed with name, phone, email and join date on Owner → Staff. The ledger reuses exactly these people — no second staff list.
- **Permissions**: the per-person toggle system already covers 13 sections (Counter Sale, Purchases, Reports, Staff, etc.). The ledger reuses this, adding one new toggle.
- **Purchases**: the only existing money-out records, and they are strictly ingredient purchases tied to stock. Salaries must not go here.
- **Reports**: sales-only (revenue from orders). No expense or profit side exists.
- **Counter sale / POS**: records orders and payment method; it holds no cash drawer, no petty cash and no expense entries.

## What is missing

Everything on the staff-money side: there is no salary amount per person, no payment history, no advance or loan balance, no bonus/deduction record, no overtime record, and no "what do we still owe this person" figure. Nothing in the app currently subtracts wages from revenue.

## What gets built

1. **Salary profile per team member** — monthly or daily rate, hourly overtime rate, payday, optional employment start date, active/inactive. One profile per person.
2. **Ledger entries** — one dated record per money event, typed as: salary payment, advance, loan given, loan repayment, bonus, deduction, overtime pay, other. Each carries amount, date, note, payment method (cash / bank / mobile) and who recorded it.
3. **Running balances** — per person: total paid this month, outstanding salary due, outstanding advance, outstanding loan, lifetime paid. Computed from entries, never stored as a stale number.
4. **Staff Accounts screen** (Owner → Staff Accounts): list of team members with rate and outstanding amounts, a per-person detail view with full dated history, filters by month and type, and simple "Pay salary / Give advance / Add bonus / Record deduction / Record repayment / Add overtime" actions.
5. **Payroll summary** — total wage cost for a chosen month, shown on the new screen only. The existing Reports screen is left untouched.

## Integration without touching existing features

- Purchases, inventory, POS, orders and existing reports are read-only for this work; no existing table gains or loses a column.
- One new permission key `staff_finance`, defaulting off for staff, so owners and managers see it and existing staff members' access is unchanged.
- A new dashboard tab appears only for people with that permission, added to the existing tab list.

## Technical detail

- New tables: `public.staff_salary_profiles` (user_id unique, pay_type, monthly/daily rate, overtime hourly rate, payday, starts_on, is_active) and `public.staff_ledger_entries` (user_id, entry_type, amount, entry_date, payment_method, note, recorded_by, created_at/updated_at + updated_at trigger). Indexes on user_id and entry_date.
- GRANTs to `authenticated` and `service_role`, RLS on both tables: each person may read only their own rows; all writes go through server functions using the admin client after `assertPermission(userId, "staff_finance")`. No direct client writes.
- New `src/lib/staff-finance.functions.ts` with list/summary/create/update/delete server functions, each permission-checked, mirroring the shape of `purchases.functions.ts`.
- `src/lib/permissions.ts` gains `staff_finance` with label "Staff Accounts"; `owner.server.ts` needs no change since it reads the catalogue.
- New route `src/routes/_authenticated/owner.staff-accounts.tsx` plus one entry in `TABS` in `owner.tsx`.
- Amounts stored as `numeric(12,2)`; all sums computed server-side in the summary function.
- Verification: build/typecheck plus a signed-in pass over the new screen creating and deleting a test entry, confirming Purchases, POS and Reports are unaffected.
