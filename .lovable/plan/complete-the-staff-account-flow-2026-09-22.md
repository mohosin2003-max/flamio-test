# Complete the staff account flow

## Goal
Make one existing Flamio account identity work correctly as either a customer or staff member, with secure staff creation, automatic legacy-invite claiming, correct dashboard routing, and the existing granular access levels.

## What is currently wrong
- Staff invitations save only a loosely normalized value in `owner_invites.phone`; customer signup saves phones in canonical `880…` form, so the records often never match.
- Listing staff detects a possible match but nothing claims an invitation during authentication. A role is created only after a separate Owner click, so the account remains a customer and follows customer routing.
- The current invite form does not save the selected role or permissions with a pending invite.
- Login always treats the input as a phone and converts it to a synthetic email; real email login and phone OTP signup are not implemented.
- Staff password change currently points to the recovery flow instead of providing a signed-in password-change form.
- Owner/Manager compatibility roles still override granular section choices with full access.

## Implementation
1. **Secure Owner-created staff accounts**
   - Replace the pending-only form with Staff name, phone, optional email, initial password, legacy role, and the existing Section Access editor.
   - Use an authenticated Owner-only server function to create the auth user through the existing auth provider, then write the existing profile, role, and permission rows as one guarded operation.
   - Never store, return, or redisplay the password. Prevent duplicates by checking normalized phone, normalized email, existing auth identities, profiles, roles, and pending invites before creation.
   - Keep legacy pending invites visible for already-created records.

2. **Claim existing pending invitations**
   - Add an authenticated claim function called immediately after signup/sign-in and before landing-page selection.
   - Match only the signed-in user’s verified auth email/phone and their canonical profile phone/email; never use display name or caller-supplied identity.
   - Normalize old phone formats during comparison, grant the existing `staff` role idempotently, remove the claimed invite, and refuse ambiguous or already-linked identities.
   - Existing pending rows cannot contain historical permission choices because the current schema never stored them; they will become Staff with no section access until the Owner assigns levels.

3. **One email-or-phone authentication screen**
   - Login accepts one “Email or phone number” value and password. Email uses the existing auth email identity; phone supports both current phone-derived accounts and native phone identities.
   - Signup has clearly separated Email and Phone methods. Email signup requires email + phone and enters email verification; phone signup requires phone, allows optional email, and enters SMS OTP verification.
   - Create/update the existing profile only after the authenticated identity is established, then claim a matching staff invite and route staff to `/owner`; customers continue to `/account/orders`.
   - Preserve recovery behavior and surface provider/configuration failures clearly.

4. **Staff access and account settings**
   - Keep the legacy Role field for compatibility, but make per-section No access / View only / Full access the effective control for Staff accounts.
   - Remove Manager/Owner locking from the editor only where granular staff control is intended; preserve Owner safety and existing server authorization rules.
   - Add signed-in password change to the existing staff account area using current password + new password through the auth provider.

5. **Verification**
   - Run focused checks for normalization, duplicate prevention, invite claiming, role/permission persistence, and view-only write rejection.
   - Verify login/signup states and public/protected routing in the browser where the external provider allows it.
   - Confirm typecheck and production preview build, then check diagnostics.

## Database and configuration
- **No SQL migration is planned.** This reuses `profiles`, `owner_invites`, `user_roles`, and `staff_permissions`.
- Email OTP and phone OTP depend on the External Supabase project’s enabled provider/template settings and SMS delivery configuration; the app will use those existing provider capabilities without storing OTPs or passwords.
