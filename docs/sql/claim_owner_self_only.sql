-- Fix: claim_owner must only allow a caller to claim ownership for their own
-- authenticated user (auth.uid()). Additive, non-destructive: replaces the
-- function body only; no tables, data, grants, or RLS policies are changed.

CREATE OR REPLACE FUNCTION public.claim_owner(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A caller may only claim ownership for their own authenticated user.
  IF _user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'owner') THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'owner')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_owner(uuid) TO authenticated, service_role;
