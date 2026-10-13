BEGIN;
CREATE OR REPLACE FUNCTION public.apply_stock_change(_item_id uuid, _change_type text, _quantity numeric, _note text DEFAULT NULL::text, _created_by uuid DEFAULT NULL::uuid) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
    WHEN 'waste' THEN v_current - _quantity
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
COMMIT;
