CREATE TABLE public.combos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT false,
  pricing_mode text NOT NULL DEFAULT 'calculated' CHECK (pricing_mode IN ('calculated','fixed')),
  fixed_price numeric,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.combos TO anon;
GRANT SELECT ON public.combos TO authenticated;
GRANT ALL ON public.combos TO service_role;

ALTER TABLE public.combos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active combos are publicly readable"
  ON public.combos FOR SELECT
  USING (is_active);

CREATE TRIGGER update_combos_updated_at
  BEFORE UPDATE ON public.combos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.combo_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  combo_id uuid NOT NULL REFERENCES public.combos(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_required boolean NOT NULL DEFAULT true,
  min_select integer NOT NULL DEFAULT 1,
  max_select integer NOT NULL DEFAULT 1,
  extra_charge numeric NOT NULL DEFAULT 0,
  category_ids uuid[] NOT NULL DEFAULT '{}',
  product_ids uuid[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX combo_groups_combo_id_idx ON public.combo_groups(combo_id);

GRANT SELECT ON public.combo_groups TO anon;
GRANT SELECT ON public.combo_groups TO authenticated;
GRANT ALL ON public.combo_groups TO service_role;

ALTER TABLE public.combo_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Groups of active combos are publicly readable"
  ON public.combo_groups FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.combos c WHERE c.id = combo_id AND c.is_active));

CREATE TRIGGER update_combo_groups_updated_at
  BEFORE UPDATE ON public.combo_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.order_items
  ADD COLUMN combo_name text,
  ADD COLUMN combo_key text;