CREATE TABLE public.staff_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission)
);

GRANT SELECT ON public.staff_permissions TO authenticated;
GRANT ALL ON public.staff_permissions TO service_role;

ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own permissions"
ON public.staff_permissions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER update_staff_permissions_updated_at
BEFORE UPDATE ON public.staff_permissions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();