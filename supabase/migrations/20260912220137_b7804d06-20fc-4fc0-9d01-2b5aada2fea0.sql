CREATE TABLE public.riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.riders TO authenticated;
GRANT ALL ON public.riders TO service_role;

ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view riders"
ON public.riders FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'staff')
);

CREATE TRIGGER update_riders_updated_at
BEFORE UPDATE ON public.riders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.orders
  ADD COLUMN rider_id uuid REFERENCES public.riders(id) ON DELETE SET NULL;