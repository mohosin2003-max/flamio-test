CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  order_code text,
  status text,
  title text NOT NULL,
  body text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers can view their notifications" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Customers can update their notifications" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL DEFAULT 'web',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;
GRANT ALL ON public.push_tokens TO service_role;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers manage their push tokens" ON public.push_tokens FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_push_tokens_updated_at BEFORE UPDATE ON public.push_tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.notification_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  push_token_id uuid NOT NULL REFERENCES public.push_tokens(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.notification_push_deliveries TO service_role;
ALTER TABLE public.notification_push_deliveries ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_notification_push_deliveries_updated_at BEFORE UPDATE ON public.notification_push_deliveries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'pcs',
  current_stock numeric NOT NULL DEFAULT 0,
  low_stock_threshold numeric NOT NULL DEFAULT 0,
  unit_cost numeric,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view inventory items" ON public.inventory_items FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')
);
CREATE TRIGGER update_inventory_items_updated_at BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  change_type text NOT NULL,
  quantity numeric NOT NULL,
  resulting_stock numeric NOT NULL,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view inventory movements" ON public.inventory_movements FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')
);

CREATE TABLE public.product_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, item_id)
);
GRANT SELECT ON public.product_ingredients TO authenticated;
GRANT ALL ON public.product_ingredients TO service_role;
ALTER TABLE public.product_ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view recipes" ON public.product_ingredients FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')
);
CREATE TRIGGER update_product_ingredients_updated_at BEFORE UPDATE ON public.product_ingredients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  supplier_name text NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL DEFAULT 0,
  total_price numeric NOT NULL DEFAULT 0,
  purchased_on date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view purchases" ON public.purchases FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')
);
CREATE TRIGGER update_purchases_updated_at BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.apply_stock_change(
  _item_id uuid,
  _change_type text,
  _quantity numeric,
  _note text DEFAULT NULL,
  _created_by uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current numeric;
  v_next numeric;
BEGIN
  SELECT current_stock INTO v_current FROM public.inventory_items WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  v_next := CASE _change_type
    WHEN 'add' THEN v_current + _quantity
    WHEN 'reduce' THEN v_current - _quantity
    WHEN 'update' THEN _quantity
    ELSE NULL
  END;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Unknown change type %', _change_type;
  END IF;

  IF v_next < 0 THEN
    RAISE EXCEPTION 'Not enough stock';
  END IF;

  UPDATE public.inventory_items SET current_stock = v_next WHERE id = _item_id;

  INSERT INTO public.inventory_movements (item_id, change_type, quantity, resulting_stock, note, created_by)
  VALUES (_item_id, _change_type, _quantity, v_next, _note, _created_by);

  RETURN v_next;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_stock_change(uuid, text, numeric, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_stock_change(uuid, text, numeric, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.apply_stock_change(uuid, text, numeric, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stock_change(uuid, text, numeric, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_inventory_for_order(_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count numeric := 0;
  v_next numeric;
BEGIN
  IF EXISTS (SELECT 1 FROM public.inventory_movements WHERE order_id = _order_id) THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT pi.item_id AS item_id, SUM(pi.quantity * oi.quantity) AS needed
    FROM public.order_items oi
    JOIN public.product_ingredients pi ON pi.product_id = oi.product_id
    WHERE oi.order_id = _order_id
    GROUP BY pi.item_id
  LOOP
    UPDATE public.inventory_items
    SET current_stock = GREATEST(current_stock - v_row.needed, 0)
    WHERE id = v_row.item_id
    RETURNING current_stock INTO v_next;

    INSERT INTO public.inventory_movements (item_id, order_id, change_type, quantity, resulting_stock, note)
    VALUES (v_row.item_id, _order_id, 'order', v_row.needed, v_next, 'Automatic deduction for order');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_inventory_for_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_inventory_for_order(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.consume_inventory_for_order(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_inventory_for_order(uuid) TO service_role;