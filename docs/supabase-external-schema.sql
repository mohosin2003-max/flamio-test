-- =====================================================================
-- Flamio — schema migration package for a FRESH external Supabase project
-- Generated from the live Lovable Cloud schema (structure only) and
-- docs/supabase-migration-plan.md. Contains NO production data and NO secrets.
--
-- Contents, in dependency order:
--   1. Enum type (app_role)
--   2. Functions (SECURITY DEFINER helpers + trigger functions)
--   3. Tables, primary/unique/foreign keys, indexes
--   4. Triggers
--   5. RLS enablement + all 42 policies on public tables
--   6. GRANTs for anon / authenticated / service_role
--   7. Storage RLS policies for the 4 buckets (11 rules)
--
-- NOT included on purpose (see the report / migration plan):
--   * seed or demo rows  -> restore YOUR production data instead
--   * production data, auth users, storage objects
--   * secrets, keys, environment values
--   * bucket creation and auth settings (Dashboard steps, listed at the end)
--
-- Safety: no DROP, no TRUNCATE, no DELETE, no ALTER DATABASE anywhere.
-- Run once, on an empty project, inside a single transaction.
-- =====================================================================

BEGIN;

SET check_function_bodies = false;

-- The `public` schema, `pgcrypto` (gen_random_uuid) and the anon/authenticated/
-- service_role roles already exist on a fresh Supabase project, so they are not
-- created here.

-- ---------------------------------------------------------------------
-- 1-5. Types, functions, tables, indexes, triggers, RLS + policies
-- ---------------------------------------------------------------------

--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'owner',
    'admin',
    'staff'
);


--
-- Name: apply_stock_change(uuid, text, numeric, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_stock_change(_item_id uuid, _change_type text, _quantity numeric, _note text DEFAULT NULL::text, _created_by uuid DEFAULT NULL::uuid) RETURNS numeric
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


--
-- Name: award_completed_order_reward(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.award_completed_order_reward() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_rule public.reward_rules%ROWTYPE;
BEGIN
  IF NEW.user_id IS NULL OR NEW.status <> 'completed' OR (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rule FROM public.reward_rules WHERE slug = 'completed_order' AND is_enabled LIMIT 1;
  IF FOUND AND v_rule.points > 0 THEN
    INSERT INTO public.reward_transactions (user_id, rule_id, action_key, reference_id, points, description)
    VALUES (NEW.user_id, v_rule.id, v_rule.slug, NEW.id::text, v_rule.points, 'Completed order ' || NEW.code)
    ON CONFLICT (user_id, action_key, reference_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: claim_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_owner(_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: consume_inventory_for_order(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_inventory_for_order(_order_id uuid) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;


--
-- Name: request_order_review(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_order_review() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.status <> 'completed' OR (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE order_id = NEW.id AND status = 'review_request'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, order_id, order_code, status, title, body)
  VALUES (
    NEW.user_id,
    NEW.id,
    NEW.code,
    'review_request',
    'How was your Flamio order? ❤️',
    'Rate your experience and share your feedback.'
  );

  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    image_url text,
    is_visible boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: challenge_play_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_play_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    challenge_id uuid NOT NULL,
    user_id uuid NOT NULL,
    source text NOT NULL,
    plays integer DEFAULT 1 NOT NULL,
    reference text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: challenge_play_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_play_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    challenge_id uuid NOT NULL,
    user_id uuid NOT NULL,
    plays_used integer DEFAULT 0 NOT NULL,
    last_play_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: challenge_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    challenge_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    score numeric DEFAULT 0 NOT NULL,
    seed text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: challenge_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    ticker_enabled boolean DEFAULT true NOT NULL,
    ticker_max_winners integer DEFAULT 10 NOT NULL,
    ticker_duration_seconds integer DEFAULT 4 NOT NULL,
    winner_retention_days integer DEFAULT 30 NOT NULL,
    auto_cleanup_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: challenge_winners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_winners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    challenge_id uuid NOT NULL,
    session_id uuid,
    user_id uuid NOT NULL,
    reward_type text NOT NULL,
    reward_name text NOT NULL,
    reward_quantity integer DEFAULT 1 NOT NULL,
    coupon_code text,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    claim_status text DEFAULT 'pending'::text NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    won_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    instructions text,
    game_type text NOT NULL,
    detector_type text NOT NULL,
    icon_emoji text DEFAULT '🎮'::text NOT NULL,
    banner_path text,
    difficulty text DEFAULT 'normal'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    starts_on date,
    ends_on date,
    daily_start_time text,
    daily_end_time text,
    attempts_per_session integer DEFAULT 1 NOT NULL,
    required_score numeric DEFAULT 0 NOT NULL,
    required_accuracy numeric,
    time_limit_seconds integer,
    winning_condition jsonb DEFAULT '{}'::jsonb NOT NULL,
    difficulty_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    rules_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    reward_type text DEFAULT 'free_item'::text NOT NULL,
    reward_name text DEFAULT 'Flamio reward'::text NOT NULL,
    reward_quantity integer DEFAULT 1 NOT NULL,
    reward_coupon_id uuid,
    reward_points integer DEFAULT 0 NOT NULL,
    base_plays integer DEFAULT 1 NOT NULL,
    max_stored_plays integer DEFAULT 1 NOT NULL,
    max_plays_per_customer integer DEFAULT 0 NOT NULL,
    cooldown_minutes integer DEFAULT 0 NOT NULL,
    refill_enabled boolean DEFAULT false NOT NULL,
    refill_interval_minutes integer DEFAULT 1440 NOT NULL,
    refill_amount integer DEFAULT 1 NOT NULL,
    order_unlock_enabled boolean DEFAULT false NOT NULL,
    order_min_amount numeric DEFAULT 0 NOT NULL,
    order_unlock_plays integer DEFAULT 1 NOT NULL,
    order_unlock_max integer DEFAULT 0 NOT NULL,
    order_unlock_stack boolean DEFAULT true NOT NULL,
    order_required_status text DEFAULT 'completed'::text NOT NULL,
    referral_unlock_enabled boolean DEFAULT false NOT NULL,
    referral_required_count integer DEFAULT 10 NOT NULL,
    referral_unlock_plays integer DEFAULT 1 NOT NULL,
    referral_unlock_max integer DEFAULT 0 NOT NULL,
    referral_cooldown_hours integer DEFAULT 0 NOT NULL,
    referral_verification text DEFAULT 'approved_claim'::text NOT NULL,
    daily_winner_limit integer DEFAULT 0 NOT NULL,
    total_winner_limit integer DEFAULT 0 NOT NULL,
    max_wins_per_customer integer DEFAULT 1 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: combo_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combo_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    combo_id uuid NOT NULL,
    name text NOT NULL,
    is_required boolean DEFAULT true NOT NULL,
    min_select integer DEFAULT 1 NOT NULL,
    max_select integer DEFAULT 1 NOT NULL,
    extra_charge numeric DEFAULT 0 NOT NULL,
    category_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    product_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: combos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT false NOT NULL,
    pricing_mode text DEFAULT 'calculated'::text NOT NULL,
    fixed_price numeric,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT combos_pricing_mode_check CHECK ((pricing_mode = ANY (ARRAY['calculated'::text, 'fixed'::text])))
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    description text,
    discount_type text DEFAULT 'percent'::text NOT NULL,
    discount_value numeric DEFAULT 0 NOT NULL,
    min_order_total numeric DEFAULT 0 NOT NULL,
    max_discount numeric,
    usage_limit integer,
    times_used integer DEFAULT 0 NOT NULL,
    starts_on timestamp with time zone,
    expires_on timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coupons_discount_type_check CHECK ((discount_type = ANY (ARRAY['percent'::text, 'amount'::text])))
);


--
-- Name: customer_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label text,
    full_name text NOT NULL,
    phone text NOT NULL,
    address_line text NOT NULL,
    area text,
    landmark text,
    delivery_notes text,
    zone_id text,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    latitude numeric,
    longitude numeric
);


--
-- Name: delivery_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    delivery_charge numeric DEFAULT 0 NOT NULL,
    minimum_order numeric DEFAULT 0 NOT NULL,
    free_delivery_threshold numeric,
    is_free_delivery_enabled boolean DEFAULT true NOT NULL,
    estimated_delivery_time text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    zone_type text DEFAULT 'area'::text NOT NULL,
    radius_min_m numeric,
    radius_max_m numeric,
    CONSTRAINT delivery_zones_zone_type_check CHECK ((zone_type = ANY (ARRAY['area'::text, 'radius'::text])))
);


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    unit text DEFAULT 'pcs'::text NOT NULL,
    current_stock numeric DEFAULT 0 NOT NULL,
    low_stock_threshold numeric DEFAULT 0 NOT NULL,
    unit_cost numeric,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    order_id uuid,
    change_type text NOT NULL,
    quantity numeric NOT NULL,
    resulting_stock numeric NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_push_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_push_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notification_id uuid NOT NULL,
    push_token_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    provider_message_id text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    order_id uuid,
    order_code text,
    status text,
    title text NOT NULL,
    body text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_slug text NOT NULL,
    product_name text NOT NULL,
    variant_id uuid,
    variant_name text,
    image_url text,
    quantity integer NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    combo_name text,
    combo_key text,
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: order_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid,
    rating integer NOT NULL,
    comment text,
    photo_path text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT order_reviews_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'hidden'::text])))
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    user_id uuid,
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    fulfillment text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    address_line text,
    area text,
    landmark text,
    delivery_notes text,
    pickup_note text,
    zone_id text,
    zone_name text,
    estimated_time text,
    payment_method text NOT NULL,
    payment_label text NOT NULL,
    coupon_code text,
    subtotal numeric DEFAULT 0 NOT NULL,
    discount numeric DEFAULT 0 NOT NULL,
    delivery_charge numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rider_id uuid,
    latitude numeric,
    longitude numeric,
    distance_m numeric
);


--
-- Name: owner_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    is_enabled boolean DEFAULT false NOT NULL,
    mode text DEFAULT 'sandbox'::text NOT NULL,
    merchant_reference text,
    note text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE payment_providers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_providers IS 'Non-secret payment provider configuration only. API keys/secrets are never stored here; they live in the server secret store.';


--
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    url text,
    alt text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_ingredients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_ingredients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    item_id uuid NOT NULL,
    quantity numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    name text NOT NULL,
    price numeric DEFAULT 0 NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    base_price numeric DEFAULT 0 NOT NULL,
    badges text[] DEFAULT '{}'::text[] NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    is_featured boolean DEFAULT false NOT NULL,
    is_popular boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    phone text,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    avatar_path text
);


--
-- Name: promo_banners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text DEFAULT 'Promotional banner'::text NOT NULL,
    subtitle text,
    cta_label text,
    cta_href text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    desktop_image_path text,
    mobile_image_path text
);


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    supplier_name text NOT NULL,
    quantity numeric NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    total_price numeric DEFAULT 0 NOT NULL,
    purchased_on date DEFAULT CURRENT_DATE NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform text DEFAULT 'web'::text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: restaurant_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text DEFAULT 'Flamio'::text NOT NULL,
    tagline text,
    address_line text,
    city text,
    country text,
    phone text,
    email text,
    is_open boolean DEFAULT true NOT NULL,
    inventory_mode text DEFAULT 'advanced'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    opens_at text,
    closes_at text,
    facebook_url text,
    instagram_url text,
    google_maps_url text,
    latitude numeric,
    longitude numeric,
    recommendations_enabled boolean DEFAULT true NOT NULL,
    recommendations_count integer DEFAULT 6 NOT NULL,
    reviews_enabled boolean DEFAULT true NOT NULL,
    review_photos_enabled boolean DEFAULT true NOT NULL,
    facebook_page_name text,
    CONSTRAINT restaurant_settings_inventory_mode_check CHECK ((inventory_mode = ANY (ARRAY['simple'::text, 'advanced'::text])))
);


--
-- Name: reward_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    rule_id uuid NOT NULL,
    reference text NOT NULL,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    review_note text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reward_claims_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500))),
    CONSTRAINT reward_claims_reference_check CHECK (((char_length(reference) >= 3) AND (char_length(reference) <= 240))),
    CONSTRAINT reward_claims_review_note_check CHECK (((review_note IS NULL) OR (char_length(review_note) <= 500))),
    CONSTRAINT reward_claims_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: reward_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    points integer DEFAULT 0 NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    requires_claim boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reward_rules_points_check CHECK ((points >= 0)),
    CONSTRAINT reward_rules_slug_check CHECK ((slug ~ '^[a-z0-9_]+$'::text))
);


--
-- Name: reward_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    rule_id uuid,
    action_key text NOT NULL,
    reference_id text NOT NULL,
    points integer NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reward_transactions_points_check CHECK ((points <> 0))
);


--
-- Name: riders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.riders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    note text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: staff_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    permission text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    note text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: categories categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_key UNIQUE (slug);


--
-- Name: challenge_play_grants challenge_play_grants_challenge_id_user_id_source_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_play_grants
    ADD CONSTRAINT challenge_play_grants_challenge_id_user_id_source_reference_key UNIQUE (challenge_id, user_id, source, reference);


--
-- Name: challenge_play_grants challenge_play_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_play_grants
    ADD CONSTRAINT challenge_play_grants_pkey PRIMARY KEY (id);


--
-- Name: challenge_play_state challenge_play_state_challenge_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_play_state
    ADD CONSTRAINT challenge_play_state_challenge_id_user_id_key UNIQUE (challenge_id, user_id);


--
-- Name: challenge_play_state challenge_play_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_play_state
    ADD CONSTRAINT challenge_play_state_pkey PRIMARY KEY (id);


--
-- Name: challenge_sessions challenge_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_sessions
    ADD CONSTRAINT challenge_sessions_pkey PRIMARY KEY (id);


--
-- Name: challenge_settings challenge_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_settings
    ADD CONSTRAINT challenge_settings_pkey PRIMARY KEY (id);


--
-- Name: challenge_winners challenge_winners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_winners
    ADD CONSTRAINT challenge_winners_pkey PRIMARY KEY (id);


--
-- Name: challenge_winners challenge_winners_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_winners
    ADD CONSTRAINT challenge_winners_session_id_key UNIQUE (session_id);


--
-- Name: challenges challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT challenges_pkey PRIMARY KEY (id);


--
-- Name: challenges challenges_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT challenges_slug_key UNIQUE (slug);


--
-- Name: combo_groups combo_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_groups
    ADD CONSTRAINT combo_groups_pkey PRIMARY KEY (id);


--
-- Name: combos combos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combos
    ADD CONSTRAINT combos_pkey PRIMARY KEY (id);


--
-- Name: combos combos_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combos
    ADD CONSTRAINT combos_slug_key UNIQUE (slug);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: customer_addresses customer_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_addresses
    ADD CONSTRAINT customer_addresses_pkey PRIMARY KEY (id);


--
-- Name: delivery_zones delivery_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_zones
    ADD CONSTRAINT delivery_zones_pkey PRIMARY KEY (id);


--
-- Name: delivery_zones delivery_zones_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_zones
    ADD CONSTRAINT delivery_zones_slug_key UNIQUE (slug);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_user_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_product_id_key UNIQUE (user_id, product_id);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: notification_push_deliveries notification_push_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_push_deliveries
    ADD CONSTRAINT notification_push_deliveries_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_reviews order_reviews_order_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_reviews
    ADD CONSTRAINT order_reviews_order_id_user_id_key UNIQUE (order_id, user_id);


--
-- Name: order_reviews order_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_reviews
    ADD CONSTRAINT order_reviews_pkey PRIMARY KEY (id);


--
-- Name: orders orders_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_code_key UNIQUE (code);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: owner_invites owner_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_invites
    ADD CONSTRAINT owner_invites_pkey PRIMARY KEY (id);


--
-- Name: payment_providers payment_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_providers
    ADD CONSTRAINT payment_providers_pkey PRIMARY KEY (id);


--
-- Name: payment_providers payment_providers_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_providers
    ADD CONSTRAINT payment_providers_slug_key UNIQUE (slug);


--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- Name: product_ingredients product_ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_ingredients
    ADD CONSTRAINT product_ingredients_pkey PRIMARY KEY (id);


--
-- Name: product_ingredients product_ingredients_product_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_ingredients
    ADD CONSTRAINT product_ingredients_product_id_item_id_key UNIQUE (product_id, item_id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_slug_key UNIQUE (slug);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: promo_banners promo_banners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_banners
    ADD CONSTRAINT promo_banners_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_token_key UNIQUE (token);


--
-- Name: restaurant_settings restaurant_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_settings
    ADD CONSTRAINT restaurant_settings_pkey PRIMARY KEY (id);


--
-- Name: reward_claims reward_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_claims
    ADD CONSTRAINT reward_claims_pkey PRIMARY KEY (id);


--
-- Name: reward_rules reward_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_rules
    ADD CONSTRAINT reward_rules_pkey PRIMARY KEY (id);


--
-- Name: reward_rules reward_rules_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_rules
    ADD CONSTRAINT reward_rules_slug_key UNIQUE (slug);


--
-- Name: reward_transactions reward_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_transactions
    ADD CONSTRAINT reward_transactions_pkey PRIMARY KEY (id);


--
-- Name: reward_transactions reward_transactions_user_id_action_key_reference_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_transactions
    ADD CONSTRAINT reward_transactions_user_id_action_key_reference_id_key UNIQUE (user_id, action_key, reference_id);


--
-- Name: riders riders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.riders
    ADD CONSTRAINT riders_pkey PRIMARY KEY (id);


--
-- Name: staff_permissions staff_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_permissions
    ADD CONSTRAINT staff_permissions_pkey PRIMARY KEY (id);


--
-- Name: staff_permissions staff_permissions_user_id_permission_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_permissions
    ADD CONSTRAINT staff_permissions_user_id_permission_key UNIQUE (user_id, permission);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: challenge_play_grants_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX challenge_play_grants_lookup ON public.challenge_play_grants USING btree (challenge_id, user_id);


--
-- Name: challenge_sessions_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX challenge_sessions_lookup ON public.challenge_sessions USING btree (challenge_id, user_id, status);


--
-- Name: challenge_winners_challenge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX challenge_winners_challenge ON public.challenge_winners USING btree (challenge_id, won_at DESC);


--
-- Name: challenge_winners_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX challenge_winners_recent ON public.challenge_winners USING btree (won_at DESC);


--
-- Name: combo_groups_combo_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX combo_groups_combo_id_idx ON public.combo_groups USING btree (combo_id);


--
-- Name: order_reviews_product_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_reviews_product_status_idx ON public.order_reviews USING btree (product_id, status);


--
-- Name: order_reviews_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_reviews_user_idx ON public.order_reviews USING btree (user_id);


--
-- Name: reward_claims_unique_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reward_claims_unique_reference ON public.reward_claims USING btree (user_id, rule_id, lower(reference));


--
-- Name: orders award_completed_order_reward_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER award_completed_order_reward_after_insert AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.award_completed_order_reward();


--
-- Name: orders award_completed_order_reward_after_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER award_completed_order_reward_after_update AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.award_completed_order_reward();


--
-- Name: orders request_order_review_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER request_order_review_after_insert AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.request_order_review();


--
-- Name: orders request_order_review_after_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER request_order_review_after_update AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.request_order_review();


--
-- Name: categories update_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: challenge_play_state update_challenge_play_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_challenge_play_state_updated_at BEFORE UPDATE ON public.challenge_play_state FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: challenge_settings update_challenge_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_challenge_settings_updated_at BEFORE UPDATE ON public.challenge_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: challenges update_challenges_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_challenges_updated_at BEFORE UPDATE ON public.challenges FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: combo_groups update_combo_groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_combo_groups_updated_at BEFORE UPDATE ON public.combo_groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: combos update_combos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_combos_updated_at BEFORE UPDATE ON public.combos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: coupons update_coupons_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_coupons_updated_at BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: customer_addresses update_customer_addresses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_customer_addresses_updated_at BEFORE UPDATE ON public.customer_addresses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: delivery_zones update_delivery_zones_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_delivery_zones_updated_at BEFORE UPDATE ON public.delivery_zones FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: inventory_items update_inventory_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_inventory_items_updated_at BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: notification_push_deliveries update_notification_push_deliveries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_notification_push_deliveries_updated_at BEFORE UPDATE ON public.notification_push_deliveries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: order_reviews update_order_reviews_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_order_reviews_updated_at BEFORE UPDATE ON public.order_reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: orders update_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: payment_providers update_payment_providers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_payment_providers_updated_at BEFORE UPDATE ON public.payment_providers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: product_images update_product_images_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_product_images_updated_at BEFORE UPDATE ON public.product_images FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: product_ingredients update_product_ingredients_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_product_ingredients_updated_at BEFORE UPDATE ON public.product_ingredients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: product_variants update_product_variants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_product_variants_updated_at BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: products update_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: promo_banners update_promo_banners_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_promo_banners_updated_at BEFORE UPDATE ON public.promo_banners FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: purchases update_purchases_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_purchases_updated_at BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: push_tokens update_push_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_push_tokens_updated_at BEFORE UPDATE ON public.push_tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: restaurant_settings update_restaurant_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_restaurant_settings_updated_at BEFORE UPDATE ON public.restaurant_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reward_claims update_reward_claims_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_reward_claims_updated_at BEFORE UPDATE ON public.reward_claims FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reward_rules update_reward_rules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_reward_rules_updated_at BEFORE UPDATE ON public.reward_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: riders update_riders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_riders_updated_at BEFORE UPDATE ON public.riders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: staff_permissions update_staff_permissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_staff_permissions_updated_at BEFORE UPDATE ON public.staff_permissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: suppliers update_suppliers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: challenge_play_grants challenge_play_grants_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_play_grants
    ADD CONSTRAINT challenge_play_grants_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: challenge_play_grants challenge_play_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_play_grants
    ADD CONSTRAINT challenge_play_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: challenge_play_state challenge_play_state_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_play_state
    ADD CONSTRAINT challenge_play_state_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: challenge_play_state challenge_play_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_play_state
    ADD CONSTRAINT challenge_play_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: challenge_sessions challenge_sessions_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_sessions
    ADD CONSTRAINT challenge_sessions_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: challenge_sessions challenge_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_sessions
    ADD CONSTRAINT challenge_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: challenge_winners challenge_winners_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_winners
    ADD CONSTRAINT challenge_winners_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: challenge_winners challenge_winners_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_winners
    ADD CONSTRAINT challenge_winners_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.challenge_sessions(id) ON DELETE SET NULL;


--
-- Name: challenge_winners challenge_winners_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_winners
    ADD CONSTRAINT challenge_winners_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: challenges challenges_reward_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT challenges_reward_coupon_id_fkey FOREIGN KEY (reward_coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL;


--
-- Name: combo_groups combo_groups_combo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_groups
    ADD CONSTRAINT combo_groups_combo_id_fkey FOREIGN KEY (combo_id) REFERENCES public.combos(id) ON DELETE CASCADE;


--
-- Name: customer_addresses customer_addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_addresses
    ADD CONSTRAINT customer_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: inventory_movements inventory_movements_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: notification_push_deliveries notification_push_deliveries_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_push_deliveries
    ADD CONSTRAINT notification_push_deliveries_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: notification_push_deliveries notification_push_deliveries_push_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_push_deliveries
    ADD CONSTRAINT notification_push_deliveries_push_token_id_fkey FOREIGN KEY (push_token_id) REFERENCES public.push_tokens(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_reviews order_reviews_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_reviews
    ADD CONSTRAINT order_reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_reviews order_reviews_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_reviews
    ADD CONSTRAINT order_reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: order_reviews order_reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_reviews
    ADD CONSTRAINT order_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: orders orders_rider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_rider_id_fkey FOREIGN KEY (rider_id) REFERENCES public.riders(id) ON DELETE SET NULL;


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_ingredients product_ingredients_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_ingredients
    ADD CONSTRAINT product_ingredients_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;


--
-- Name: product_ingredients product_ingredients_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_ingredients
    ADD CONSTRAINT product_ingredients_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: purchases purchases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: purchases purchases_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;


--
-- Name: push_tokens push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reward_claims reward_claims_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_claims
    ADD CONSTRAINT reward_claims_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: reward_claims reward_claims_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_claims
    ADD CONSTRAINT reward_claims_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.reward_rules(id) ON DELETE RESTRICT;


--
-- Name: reward_claims reward_claims_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_claims
    ADD CONSTRAINT reward_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reward_transactions reward_transactions_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_transactions
    ADD CONSTRAINT reward_transactions_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.reward_rules(id) ON DELETE SET NULL;


--
-- Name: reward_transactions reward_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_transactions
    ADD CONSTRAINT reward_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: staff_permissions staff_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_permissions
    ADD CONSTRAINT staff_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: combos Active combos are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Active combos are publicly readable" ON public.combos FOR SELECT USING (is_active);


--
-- Name: reward_rules Authenticated users can view reward rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view reward rules" ON public.reward_rules FOR SELECT TO authenticated USING (true);


--
-- Name: categories Categories are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Categories are publicly readable" ON public.categories FOR SELECT TO authenticated, anon USING (true);


--
-- Name: challenge_settings Challenge settings are readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Challenge settings are readable" ON public.challenge_settings FOR SELECT USING (true);


--
-- Name: order_reviews Customers can edit their own review; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can edit their own review" ON public.order_reviews FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: order_reviews Customers can review their own completed orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can review their own completed orders" ON public.order_reviews FOR INSERT TO authenticated WITH CHECK (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_reviews.order_id) AND (o.user_id = auth.uid()) AND (o.status = 'completed'::text))))));


--
-- Name: reward_claims Customers can submit reward claims; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can submit reward claims" ON public.reward_claims FOR INSERT TO authenticated WITH CHECK (((auth.uid() = user_id) AND (status = 'pending'::text) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.reward_rules r
  WHERE ((r.id = reward_claims.rule_id) AND r.is_enabled AND r.requires_claim)))));


--
-- Name: notifications Customers can update their notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can update their notifications" ON public.notifications FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: notifications Customers can view their notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can view their notifications" ON public.notifications FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: order_items Customers can view their own order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can view their own order items" ON public.order_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND (o.user_id = auth.uid())))));


--
-- Name: orders Customers can view their own orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can view their own orders" ON public.orders FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: order_reviews Customers can view their own reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can view their own reviews" ON public.order_reviews FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: reward_claims Customers can view their reward claims; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can view their reward claims" ON public.reward_claims FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: reward_transactions Customers can view their reward history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can view their reward history" ON public.reward_transactions FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: customer_addresses Customers manage their own addresses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers manage their own addresses" ON public.customer_addresses TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: favorites Customers manage their own favorites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers manage their own favorites" ON public.favorites TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: push_tokens Customers manage their push tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers manage their push tokens" ON public.push_tokens TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: challenge_play_grants Customers read their own play grants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers read their own play grants" ON public.challenge_play_grants FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: challenge_play_state Customers read their own play state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers read their own play state" ON public.challenge_play_state FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: challenge_sessions Customers read their own sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers read their own sessions" ON public.challenge_sessions FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: challenge_winners Customers read their own wins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers read their own wins" ON public.challenge_winners FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: delivery_zones Delivery zones are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Delivery zones are publicly readable" ON public.delivery_zones FOR SELECT TO authenticated, anon USING (true);


--
-- Name: combo_groups Groups of active combos are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Groups of active combos are publicly readable" ON public.combo_groups FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.combos c
  WHERE ((c.id = combo_groups.combo_id) AND c.is_active))));


--
-- Name: challenges Playable challenges are readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Playable challenges are readable" ON public.challenges FOR SELECT TO authenticated USING ((status = ANY (ARRAY['active'::text, 'scheduled'::text, 'paused'::text])));


--
-- Name: product_images Product images are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Product images are publicly readable" ON public.product_images FOR SELECT TO authenticated, anon USING (true);


--
-- Name: product_variants Product variants are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Product variants are publicly readable" ON public.product_variants FOR SELECT TO authenticated, anon USING (true);


--
-- Name: products Products are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Products are publicly readable" ON public.products FOR SELECT TO authenticated, anon USING (true);


--
-- Name: promo_banners Promo banners are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Promo banners are publicly readable" ON public.promo_banners FOR SELECT USING (true);


--
-- Name: restaurant_settings Restaurant settings are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Restaurant settings are publicly readable" ON public.restaurant_settings FOR SELECT TO authenticated, anon USING (true);


--
-- Name: order_reviews Restaurant team can view all reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Restaurant team can view all reviews" ON public.order_reviews FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)));


--
-- Name: inventory_items Staff can view inventory items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view inventory items" ON public.inventory_items FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)));


--
-- Name: inventory_movements Staff can view inventory movements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view inventory movements" ON public.inventory_movements FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)));


--
-- Name: payment_providers Staff can view payment providers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view payment providers" ON public.payment_providers FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)));


--
-- Name: purchases Staff can view purchases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view purchases" ON public.purchases FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)));


--
-- Name: product_ingredients Staff can view recipes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view recipes" ON public.product_ingredients FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)));


--
-- Name: riders Staff can view riders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view riders" ON public.riders FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)));


--
-- Name: suppliers Staff can view suppliers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view suppliers" ON public.suppliers FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)));


--
-- Name: profiles Users can insert their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));


--
-- Name: profiles Users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: staff_permissions Users can view their own permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own permissions" ON public.staff_permissions FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: profiles Users can view their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING ((auth.uid() = id));


--
-- Name: user_roles Users can view their own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: challenge_play_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.challenge_play_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: challenge_play_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.challenge_play_state ENABLE ROW LEVEL SECURITY;

--
-- Name: challenge_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.challenge_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: challenge_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.challenge_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: challenge_winners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.challenge_winners ENABLE ROW LEVEL SECURITY;

--
-- Name: challenges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: combo_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.combo_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: combos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.combos ENABLE ROW LEVEL SECURITY;

--
-- Name: coupons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_zones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;

--
-- Name: favorites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_push_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_push_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owner_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_providers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: product_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

--
-- Name: product_ingredients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_ingredients ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_banners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promo_banners ENABLE ROW LEVEL SECURITY;

--
-- Name: purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: push_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: reward_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reward_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: reward_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reward_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: reward_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reward_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: riders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 6. Table privileges (PostgREST needs these; RLS above still applies)
-- ---------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
GRANT SELECT ON public.categories TO anon;  -- public read policy exists

GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_play_grants TO authenticated;
GRANT ALL ON public.challenge_play_grants TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_play_state TO authenticated;
GRANT ALL ON public.challenge_play_state TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_sessions TO authenticated;
GRANT ALL ON public.challenge_sessions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_settings TO authenticated;
GRANT ALL ON public.challenge_settings TO service_role;
GRANT SELECT ON public.challenge_settings TO anon;  -- public read policy exists

GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_winners TO authenticated;
GRANT ALL ON public.challenge_winners TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenges TO authenticated;
GRANT ALL ON public.challenges TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.combo_groups TO authenticated;
GRANT ALL ON public.combo_groups TO service_role;
GRANT SELECT ON public.combo_groups TO anon;  -- public read policy exists

GRANT SELECT, INSERT, UPDATE, DELETE ON public.combos TO authenticated;
GRANT ALL ON public.combos TO service_role;
GRANT SELECT ON public.combos TO anon;  -- public read policy exists

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_addresses TO authenticated;
GRANT ALL ON public.customer_addresses TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_zones TO authenticated;
GRANT ALL ON public.delivery_zones TO service_role;
GRANT SELECT ON public.delivery_zones TO anon;  -- public read policy exists

GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.favorites TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_push_deliveries TO authenticated;
GRANT ALL ON public.notification_push_deliveries TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_reviews TO authenticated;
GRANT ALL ON public.order_reviews TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_invites TO authenticated;
GRANT ALL ON public.owner_invites TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_providers TO authenticated;
GRANT ALL ON public.payment_providers TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_images TO authenticated;
GRANT ALL ON public.product_images TO service_role;
GRANT SELECT ON public.product_images TO anon;  -- public read policy exists

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_ingredients TO authenticated;
GRANT ALL ON public.product_ingredients TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;
GRANT SELECT ON public.product_variants TO anon;  -- public read policy exists

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
GRANT SELECT ON public.products TO anon;  -- public read policy exists

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.promo_banners TO authenticated;
GRANT ALL ON public.promo_banners TO service_role;
GRANT SELECT ON public.promo_banners TO anon;  -- public read policy exists

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;
GRANT ALL ON public.push_tokens TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_settings TO authenticated;
GRANT ALL ON public.restaurant_settings TO service_role;
GRANT SELECT ON public.restaurant_settings TO anon;  -- public read policy exists

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reward_claims TO authenticated;
GRANT ALL ON public.reward_claims TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reward_rules TO authenticated;
GRANT ALL ON public.reward_rules TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reward_transactions TO authenticated;
GRANT ALL ON public.reward_transactions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.riders TO authenticated;
GRANT ALL ON public.riders TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_permissions TO authenticated;
GRANT ALL ON public.staff_permissions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- Function privileges
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_stock_change(uuid, text, numeric, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_inventory_for_order(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 7. Storage access rules (11 rules across the 4 private buckets)
--    Run AFTER creating the buckets in the Dashboard (step D below):
--    profile-photos, review-photos, banner-images, product-images — all PRIVATE.
--    banner-images intentionally has NO read rule: banner images are served
--    through server-side signed URLs created with the service-role key.
-- ---------------------------------------------------------------------

-- profile-photos (4)
CREATE POLICY "Customers can view their profile photo"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Customers can upload their profile photo"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Customers can update their profile photo"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Customers can delete their profile photo"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- review-photos (4)
CREATE POLICY "Customers can view their review photo"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'review-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Customers can upload their review photo"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'review-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Customers can delete their review photo"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'review-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Restaurant team can view review photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'review-photos'
  AND (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
  )
);

-- banner-images (3 — write only, no SELECT rule by design)
CREATE POLICY "Owners can upload banner images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'banner-images'
  AND (public.has_role(auth.uid(), 'owner'::public.app_role)
       OR public.has_role(auth.uid(), 'admin'::public.app_role))
);

CREATE POLICY "Owners can update banner images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'banner-images'
  AND (public.has_role(auth.uid(), 'owner'::public.app_role)
       OR public.has_role(auth.uid(), 'admin'::public.app_role))
)
WITH CHECK (
  bucket_id = 'banner-images'
  AND (public.has_role(auth.uid(), 'owner'::public.app_role)
       OR public.has_role(auth.uid(), 'admin'::public.app_role))
);

CREATE POLICY "Owners can delete banner images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'banner-images'
  AND (public.has_role(auth.uid(), 'owner'::public.app_role)
       OR public.has_role(auth.uid(), 'admin'::public.app_role))
);

COMMIT;

-- =====================================================================
-- Verification (run after COMMIT; all read-only)
-- =====================================================================
-- SELECT count(*) FROM pg_tables WHERE schemaname = 'public';                 -- expect 38
-- SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity;   -- expect 38
-- SELECT count(*) FROM pg_policies WHERE schemaname = 'public';               -- expect 42
-- SELECT count(*) FROM pg_policies WHERE schemaname = 'storage';              -- expect 11
-- SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public';                                                 -- expect 7
-- SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = 'public'; -- expect 32
-- SELECT count(*) FROM pg_type WHERE typname = 'app_role';                     -- expect 1

-- =====================================================================
-- Steps that CANNOT be done in SQL — do these in the Supabase Dashboard
-- =====================================================================
-- A. Auth > Providers: enable Email sign-up, and turn ON email auto-confirm
--    (the app signs customers up with synthetic phone-based emails that can
--    never receive mail, so without auto-confirm sign-up breaks).
-- B. Auth: no other provider is used. Do not enable anonymous sign-ins.
-- C. Auth users: import auth.users / auth.identities PRESERVING the original
--    UUIDs before restoring public data (FKs and storage paths depend on them).
-- D. Storage > Buckets: create 4 buckets, ALL PRIVATE:
--      profile-photos, review-photos (file size limit 5 MB = 5242880),
--      banner-images, product-images (may stay empty).
--    Buckets must exist before section 7 runs; if you run the whole file first,
--    create the buckets and then re-run section 7 on its own.
-- E. Project settings > API: copy URL + publishable/anon key + service role key
--    into your own environment configuration.
-- F. Data restore: run YOUR production data dump AFTER this file. Temporarily
--    disable only these four order triggers so completed orders in your backup
--    do not re-award rewards or re-create review-request notifications:
--      ALTER TABLE public.orders DISABLE TRIGGER award_completed_order_reward_after_insert;
--      ALTER TABLE public.orders DISABLE TRIGGER award_completed_order_reward_after_update;
--      ALTER TABLE public.orders DISABLE TRIGGER request_order_review_after_insert;
--      ALTER TABLE public.orders DISABLE TRIGGER request_order_review_after_update;
--    After restoring data, re-enable all four BEFORE going live and verify with:
--      ALTER TABLE public.orders ENABLE TRIGGER award_completed_order_reward_after_insert;
--      ALTER TABLE public.orders ENABLE TRIGGER award_completed_order_reward_after_update;
--      ALTER TABLE public.orders ENABLE TRIGGER request_order_review_after_insert;
--      ALTER TABLE public.orders ENABLE TRIGGER request_order_review_after_update;
--      SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
--        WHERE NOT t.tgisinternal AND n.nspname = 'public' AND t.tgenabled = 'O' AND c.relname = 'orders';  -- expect 4
--    No seed rows are inserted by this file, so there is nothing to de-duplicate
--    and nothing to truncate.
