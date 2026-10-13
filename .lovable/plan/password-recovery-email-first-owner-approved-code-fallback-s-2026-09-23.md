# Password recovery (email first, owner-approved code fallback, SMS-ready)

## What exists today
- "Forgot password" page only says "contact support" — no real recovery.
- Email accounts: Supabase's built-in email reset is available but not wired up.
- SMS: the provider setting + server-side check already exist (used for signup).
- Owner notifications: the existing in-app notifications table/bell.

## Customer flow (Forgot password page)
1. Customer types phone or email → server looks up the account (never reveals whether it exists beyond the needed hint).
2. Account HAS email → shows masked email (e.g. `m***@gmail.com`) and "Send email code". Uses Supabase's built-in recovery email (6-digit code with `{{ .Token }}` in the "Reset password" template, same pattern as signup) → verify → set new password. No SMS ever sent.
3. No email + SMS enabled → Supabase phone code → verify → set new password. If sending fails, fall back to step 4.
4. No email + no SMS → "Request recovery" creates ONE pending request (repeat requests while pending just show "already requested"). Owner/recovery staff get an in-app notification.
5. After approval the customer opens "I have a recovery code", enters phone + code + new password → password changes, code is burned.

## Owner side
- New "Account recovery" list in the owner area (owner + staff with a new `recovery` permission).
- Shows customer name, masked phone, account age, recent orders — to verify by phone call.
- Approve → a one-time code (e.g. 8 characters) is shown ONCE to read to the customer by phone. Reject → request closed.
- Owner never sees or sets the password.

## Security
- Code stored only as a hash; valid 30 days; single use; invalid after use/expiry.
- Rate limits: max 3 requests/phone/day, max 5 wrong code attempts per request then locked.
- Audit: status, requested_at, approved_by, approved_at, used_at, rejected_by, attempts.
- All checks server-side; password set via admin API only after code verified.

## Needs your approval: one additive SQL file
`docs/sql/password_recovery.sql` (you run it in Supabase): new table `password_recovery_requests` + RLS (no public access; server-only), grants, indexes. No changes to existing tables/data.

## Supabase Dashboard (you)
- "Reset password" email template: add `{{ .Token }}` so the email contains a 6-digit code.

## Technical details
- New: `src/lib/recovery.functions.ts` (lookupRecovery, requestManualRecovery, redeemRecoveryCode, listRecoveryRequests, approve/rejectRecovery), `src/routes/_authenticated/owner.recovery.tsx`.
- Edit: `src/routes/forgot-password.tsx` (flow UI), `src/lib/permissions.ts` (add `recovery`), owner nav link.
- Email: `resetPasswordForEmail` → `verifyOtp({type:"recovery"})` → `updateUser({password})`. SMS: `signInWithOtp({phone, shouldCreateUser:false})` → `verifyOtp({type:"sms"})` → `updateUser`.
- Untouched: signup, login, email/SMS signup OTP, guards.
