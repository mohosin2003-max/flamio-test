-- Password recovery requests (additive only; no existing table is changed).
-- Server-only table: the browser never reads or writes it directly.

CREATE TABLE IF NOT EXISTS public.password_recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'used', 'expired', 'locked')),
  code_hash text,
  attempts integer NOT NULL DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.password_recovery_requests TO service_role;

ALTER TABLE public.password_recovery_requests ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated on purpose: only the server (service role) can access it.

-- At most one open (pending or approved) request per account.
CREATE UNIQUE INDEX IF NOT EXISTS password_recovery_one_open_per_user
  ON public.password_recovery_requests (user_id)
  WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS password_recovery_phone_requested_idx
  ON public.password_recovery_requests (phone, requested_at DESC);

CREATE INDEX IF NOT EXISTS password_recovery_status_idx
  ON public.password_recovery_requests (status, requested_at DESC);
