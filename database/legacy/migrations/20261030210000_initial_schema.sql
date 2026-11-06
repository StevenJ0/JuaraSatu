-- GTNIC 2026: Initial database schema v1.0 (20261030210000 baseline)
-- Source of truth: docs/schema.md (29 October 2026)
-- PostgreSQL / Supabase. Run once on a NEW project or after inspecting existing objects.
-- Creates 17 tables, constraints, indexes, updated_at triggers, and owner-only read RLS.
-- DOES NOT create checkout/payment RPCs, storage buckets, seed data, or production data.
-- All writes are intentionally performed by authorized Next.js server code.

BEGIN;

-- ============================================================================
-- 1. Business & authentication (Supabase Auth owns auth.users)
-- ============================================================================
CREATE TABLE public.businesses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
    slug varchar(140) NOT NULL UNIQUE
        CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    category varchar(80) NOT NULL CHECK (length(btrim(category)) > 0),
    description text,
    public_contact varchar(120),
    pickup_instructions text,
    timezone varchar(64) NOT NULL DEFAULT 'Asia/Jakarta',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.business_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    role varchar(20) NOT NULL DEFAULT 'owner' CHECK (role = 'owner'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT business_members_business_user_uniq UNIQUE (business_id, user_id)
);
CREATE UNIQUE INDEX business_members_one_owner_per_business
    ON public.business_members(business_id) WHERE role = 'owner';
CREATE UNIQUE INDEX business_members_one_business_per_owner
    ON public.business_members(user_id) WHERE role = 'owner';

-- ============================================================================
-- 2. Product & shared production capacity
-- ============================================================================
CREATE TABLE public.products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
    description text,
    photo_path text,
    base_price_idr bigint NOT NULL CHECK (base_price_idr > 0),
    variable_cost_idr bigint CHECK (variable_cost_idr >= 0),
    cost_quality varchar(16) NOT NULL DEFAULT 'unknown'
        CHECK (cost_quality IN ('unknown', 'estimated', 'verified')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT products_id_business_uniq UNIQUE (id, business_id),
    CONSTRAINT products_cost_quality_consistent CHECK (
        (cost_quality = 'unknown' AND variable_cost_idr IS NULL) OR
        (cost_quality IN ('estimated', 'verified') AND variable_cost_idr IS NOT NULL)
    )
);
CREATE INDEX products_business_active_idx ON public.products(business_id, is_active);

CREATE TABLE public.production_capacity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    fulfillment_date date NOT NULL,
    total_units integer NOT NULL CHECK (total_units >= 0),
    order_deadline_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT production_capacity_business_date_uniq UNIQUE (business_id, fulfillment_date),
    CONSTRAINT production_capacity_id_business_uniq UNIQUE (id, business_id)
);

-- ============================================================================
-- 3. Campaigns & AI generation
-- ============================================================================
CREATE TABLE public.campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    product_id uuid NOT NULL,
    name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
    slug varchar(160) NOT NULL UNIQUE
        CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    status varchar(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'closed', 'completed', 'cancelled')),
    strategy_type varchar(30) NOT NULL
        CHECK (strategy_type IN ('limited_preorder', 'limited_discount')),
    discount_type varchar(12) NOT NULL DEFAULT 'none'
        CHECK (discount_type IN ('none', 'percent', 'fixed')),
    discount_value bigint NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
    base_price_snapshot_idr bigint NOT NULL CHECK (base_price_snapshot_idr > 0),
    offer_price_idr bigint NOT NULL CHECK (offer_price_idr > 0),
    fulfillment_date date NOT NULL,
    quota_units integer NOT NULL CHECK (quota_units > 0),
    target_units integer NOT NULL CHECK (target_units > 0),
    budget_cap_idr bigint NOT NULL DEFAULT 0 CHECK (budget_cap_idr >= 0),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT campaigns_product_same_business_fk
        FOREIGN KEY (product_id, business_id)
        REFERENCES public.products(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT campaigns_capacity_date_fk
        FOREIGN KEY (business_id, fulfillment_date)
        REFERENCES public.production_capacity(business_id, fulfillment_date) ON DELETE RESTRICT,
    CONSTRAINT campaigns_id_business_uniq UNIQUE (id, business_id),
    CONSTRAINT campaigns_id_business_date_uniq UNIQUE (id, business_id, fulfillment_date),
    CONSTRAINT campaigns_time_valid CHECK (ends_at > starts_at),
    CONSTRAINT campaigns_discount_valid CHECK (
        (discount_type = 'none' AND discount_value = 0) OR
        (discount_type = 'percent' AND discount_value BETWEEN 1 AND 10000) OR
        (discount_type = 'fixed' AND discount_value > 0)
    ),
    CONSTRAINT campaigns_strategy_discount_valid CHECK (
        (strategy_type = 'limited_preorder' AND discount_type = 'none') OR
        (strategy_type = 'limited_discount' AND discount_type <> 'none')
    ),
    CONSTRAINT campaigns_offer_not_above_base CHECK (offer_price_idr <= base_price_snapshot_idr)
);
CREATE INDEX campaigns_business_status_idx ON public.campaigns(business_id, status);
CREATE INDEX campaigns_business_fulfillment_idx ON public.campaigns(business_id, fulfillment_date);

CREATE TABLE public.ai_generations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    campaign_id uuid,
    generation_type varchar(30) NOT NULL
        CHECK (generation_type IN ('strategies', 'execution_plan', 'evaluation')),
    model_name varchar(100),
    input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
    output_json jsonb,
    status varchar(16) NOT NULL
        CHECK (status IN ('success', 'failed', 'invalid_output')),
    error_code varchar(60),
    generated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_generations_campaign_business_fk
        FOREIGN KEY (campaign_id, business_id)
        REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT ai_generations_id_business_uniq UNIQUE (id, business_id)
);
CREATE INDEX ai_generations_campaign_idx
    ON public.ai_generations(business_id, campaign_id, generation_type, generated_at DESC);
CREATE INDEX ai_generations_input_hash_idx ON public.ai_generations(business_id, input_hash);

CREATE TABLE public.campaign_blueprints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL,
    business_id uuid NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    approval_status varchar(16) NOT NULL DEFAULT 'proposed'
        CHECK (approval_status IN ('proposed', 'approved', 'discarded')),
    blueprint_json jsonb NOT NULL CHECK (jsonb_typeof(blueprint_json) = 'object'),
    source_ai_generation_id uuid,
    approved_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT campaign_blueprints_campaign_business_fk
        FOREIGN KEY (campaign_id, business_id)
        REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT campaign_blueprints_generation_business_fk
        FOREIGN KEY (source_ai_generation_id, business_id)
        REFERENCES public.ai_generations(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT campaign_blueprints_campaign_version_uniq UNIQUE (campaign_id, version),
    CONSTRAINT campaign_blueprints_approved_details CHECK (
        approval_status <> 'approved' OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
    )
);
CREATE UNIQUE INDEX campaign_blueprints_one_approved_idx
    ON public.campaign_blueprints(campaign_id) WHERE approval_status = 'approved';
CREATE INDEX campaign_blueprints_business_campaign_idx
    ON public.campaign_blueprints(business_id, campaign_id, created_at DESC);

CREATE TABLE public.campaign_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL,
    business_id uuid NOT NULL,
    title varchar(160) NOT NULL CHECK (length(btrim(title)) > 0),
    description text,
    channel varchar(30),
    due_at timestamptz,
    sort_order integer NOT NULL DEFAULT 0,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT campaign_tasks_campaign_business_fk
        FOREIGN KEY (campaign_id, business_id)
        REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT
);
CREATE INDEX campaign_tasks_business_campaign_due_idx
    ON public.campaign_tasks(business_id, campaign_id, due_at);

CREATE TABLE public.campaign_contents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL,
    business_id uuid NOT NULL,
    channel varchar(30) NOT NULL
        CHECK (channel IN ('whatsapp', 'instagram', 'landing_page')),
    content_type varchar(20) NOT NULL
        CHECK (content_type IN ('headline', 'caption', 'cta')),
    body text NOT NULL CHECK (length(btrim(body)) > 0),
    source_ai_generation_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT campaign_contents_campaign_business_fk
        FOREIGN KEY (campaign_id, business_id)
        REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT campaign_contents_generation_business_fk
        FOREIGN KEY (source_ai_generation_id, business_id)
        REFERENCES public.ai_generations(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT campaign_contents_campaign_channel_type_uniq
        UNIQUE (campaign_id, channel, content_type)
);
CREATE INDEX campaign_contents_business_campaign_idx
    ON public.campaign_contents(business_id, campaign_id);

-- ============================================================================
-- 4. Orders & reservations (customer uses server-mediated private token)
-- ============================================================================
CREATE TABLE public.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    campaign_id uuid,
    public_order_number varchar(32) NOT NULL UNIQUE,
    private_token_hash char(64) UNIQUE
        CHECK (private_token_hash IS NULL OR private_token_hash ~ '^[0-9a-f]{64}$'),
    idempotency_key varchar(128),
    source varchar(12) NOT NULL CHECK (source IN ('campaign', 'manual')),
    customer_name varchar(120) NOT NULL CHECK (length(btrim(customer_name)) > 0),
    customer_contact varchar(120) NOT NULL CHECK (length(btrim(customer_contact)) > 0),
    fulfillment_date date NOT NULL,
    payment_mode varchar(24) NOT NULL
        CHECK (payment_mode IN ('midtrans_sandbox', 'external_manual')),
    order_status varchar(24) NOT NULL
        CHECK (order_status IN (
            'pending_payment', 'awaiting_confirmation', 'active',
            'cancelled', 'expired', 'requires_review'
        )),
    fulfillment_status varchar(24) NOT NULL DEFAULT 'pending_confirmation'
        CHECK (fulfillment_status IN (
            'pending_confirmation', 'confirmed', 'in_production',
            'ready', 'fulfilled', 'cancelled'
        )),
    subtotal_idr bigint NOT NULL CHECK (subtotal_idr >= 0),
    discount_total_idr bigint NOT NULL DEFAULT 0 CHECK (discount_total_idr >= 0),
    total_idr bigint NOT NULL CHECK (total_idr >= 0),
    payment_due_at timestamptz,
    cancel_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orders_campaign_business_date_fk
        FOREIGN KEY (campaign_id, business_id, fulfillment_date)
        REFERENCES public.campaigns(id, business_id, fulfillment_date) ON DELETE RESTRICT,
    CONSTRAINT orders_business_capacity_date_fk
        FOREIGN KEY (business_id, fulfillment_date)
        REFERENCES public.production_capacity(business_id, fulfillment_date) ON DELETE RESTRICT,
    CONSTRAINT orders_id_business_uniq UNIQUE (id, business_id),
    CONSTRAINT orders_subtotal_match CHECK (total_idr = subtotal_idr - discount_total_idr),
    CONSTRAINT orders_source_mode_valid CHECK (
        (source = 'campaign' AND campaign_id IS NOT NULL AND
         payment_mode = 'midtrans_sandbox' AND private_token_hash IS NOT NULL AND
         idempotency_key IS NOT NULL AND total_idr > 0) OR
        (source = 'manual' AND campaign_id IS NULL AND payment_mode = 'external_manual')
    )
);
CREATE UNIQUE INDEX orders_business_idempotency_uniq
    ON public.orders(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX orders_business_fulfillment_status_idx
    ON public.orders(business_id, fulfillment_date, order_status);
CREATE INDEX orders_campaign_created_idx ON public.orders(campaign_id, created_at);

CREATE TABLE public.order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    business_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name_snapshot varchar(160) NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    base_unit_price_idr bigint NOT NULL CHECK (base_unit_price_idr >= 0),
    discount_per_unit_idr bigint NOT NULL DEFAULT 0 CHECK (discount_per_unit_idr >= 0),
    final_unit_price_idr bigint NOT NULL CHECK (final_unit_price_idr >= 0),
    variable_cost_per_unit_idr bigint CHECK (variable_cost_per_unit_idr >= 0),
    line_total_idr bigint NOT NULL CHECK (line_total_idr >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT order_items_order_business_fk
        FOREIGN KEY (order_id, business_id)
        REFERENCES public.orders(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT order_items_product_business_fk
        FOREIGN KEY (product_id, business_id)
        REFERENCES public.products(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT order_items_price_snapshot_valid CHECK (
        discount_per_unit_idr <= base_unit_price_idr AND
        final_unit_price_idr = base_unit_price_idr - discount_per_unit_idr AND
        line_total_idr = quantity::bigint * final_unit_price_idr
    )
);
CREATE INDEX order_items_order_idx ON public.order_items(order_id);
CREATE INDEX order_items_business_product_idx ON public.order_items(business_id, product_id);

CREATE TABLE public.capacity_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    capacity_id uuid NOT NULL,
    order_id uuid NOT NULL UNIQUE,
    campaign_id uuid,
    quantity integer NOT NULL CHECK (quantity > 0),
    state varchar(12) NOT NULL CHECK (state IN ('held', 'allocated', 'released')),
    expires_at timestamptz,
    released_at timestamptz,
    release_reason varchar(40),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT capacity_reservations_capacity_business_fk
        FOREIGN KEY (capacity_id, business_id)
        REFERENCES public.production_capacity(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT capacity_reservations_order_business_fk
        FOREIGN KEY (order_id, business_id)
        REFERENCES public.orders(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT capacity_reservations_campaign_business_fk
        FOREIGN KEY (campaign_id, business_id)
        REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT capacity_reservations_state_valid CHECK (
        (state = 'held' AND expires_at IS NOT NULL AND released_at IS NULL) OR
        (state = 'allocated' AND expires_at IS NULL AND released_at IS NULL) OR
        (state = 'released' AND released_at IS NOT NULL)
    )
);
CREATE INDEX capacity_reservations_active_idx
    ON public.capacity_reservations(business_id, capacity_id, state, expires_at);
CREATE INDEX capacity_reservations_campaign_state_idx
    ON public.capacity_reservations(campaign_id, state);

CREATE TABLE public.order_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    business_id uuid NOT NULL,
    event_type varchar(40) NOT NULL,
    from_status varchar(32),
    to_status varchar(32),
    actor_type varchar(20) NOT NULL CHECK (actor_type IN ('owner', 'system', 'provider')),
    actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
    details_json jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(details_json) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT order_events_order_business_fk
        FOREIGN KEY (order_id, business_id)
        REFERENCES public.orders(id, business_id) ON DELETE RESTRICT
);
CREATE INDEX order_events_business_order_created_idx
    ON public.order_events(business_id, order_id, created_at);

-- ============================================================================
-- 5. Shared Midtrans Sandbox, isolated internal payment attempts
-- ============================================================================
CREATE TABLE public.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    business_id uuid NOT NULL,
    provider varchar(32) NOT NULL DEFAULT 'midtrans_sandbox'
        CHECK (provider = 'midtrans_sandbox'),
    provider_order_id varchar(128) NOT NULL UNIQUE,
    provider_transaction_id varchar(128) UNIQUE,
    attempt_number integer NOT NULL CHECK (attempt_number >= 1),
    amount_idr bigint NOT NULL CHECK (amount_idr > 0),
    status varchar(24) NOT NULL CHECK (status IN (
        'initiating', 'pending', 'paid_sandbox', 'expired', 'failed',
        'cancelled', 'refund_pending', 'refunded_sandbox'
    )),
    qr_content text,
    qr_expires_at timestamptz,
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payments_order_business_fk
        FOREIGN KEY (order_id, business_id)
        REFERENCES public.orders(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT payments_id_business_uniq UNIQUE (id, business_id),
    CONSTRAINT payments_order_attempt_uniq UNIQUE (order_id, attempt_number)
);
CREATE UNIQUE INDEX payments_one_paid_attempt_per_order_idx
    ON public.payments(order_id) WHERE status = 'paid_sandbox';
CREATE INDEX payments_business_status_created_idx
    ON public.payments(business_id, status, created_at);

CREATE TABLE public.payment_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL,
    business_id uuid NOT NULL,
    provider_event_key varchar(160) NOT NULL,
    provider_status varchar(40) NOT NULL,
    payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    signature_valid boolean NOT NULL,
    processed_at timestamptz,
    processing_outcome varchar(24) NOT NULL
        CHECK (processing_outcome IN ('processed', 'duplicate', 'ignored', 'review_required', 'error')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payment_events_payment_business_fk
        FOREIGN KEY (payment_id, business_id)
        REFERENCES public.payments(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT payment_events_payment_event_uniq UNIQUE (payment_id, provider_event_key)
);
CREATE INDEX payment_events_business_payment_created_idx
    ON public.payment_events(business_id, payment_id, created_at);

-- ============================================================================
-- 6. Campaign costs & evaluations
-- ============================================================================
CREATE TABLE public.campaign_costs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL,
    business_id uuid NOT NULL,
    category varchar(40) NOT NULL CHECK (length(btrim(category)) > 0),
    description text,
    amount_idr bigint NOT NULL CHECK (amount_idr >= 0),
    incurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT campaign_costs_campaign_business_fk
        FOREIGN KEY (campaign_id, business_id)
        REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT
);
CREATE INDEX campaign_costs_business_campaign_idx
    ON public.campaign_costs(business_id, campaign_id);

CREATE TABLE public.campaign_evaluations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL,
    business_id uuid NOT NULL,
    metrics_json jsonb NOT NULL CHECK (jsonb_typeof(metrics_json) = 'object'),
    analysis_text text,
    limitations_json jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(limitations_json) = 'array'),
    source_ai_generation_id uuid,
    evaluated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT campaign_evaluations_campaign_business_fk
        FOREIGN KEY (campaign_id, business_id)
        REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT,
    CONSTRAINT campaign_evaluations_generation_business_fk
        FOREIGN KEY (source_ai_generation_id, business_id)
        REFERENCES public.ai_generations(id, business_id) ON DELETE RESTRICT
);
CREATE INDEX campaign_evaluations_business_campaign_evaluated_idx
    ON public.campaign_evaluations(business_id, campaign_id, evaluated_at DESC);

-- ============================================================================
-- 7. Updated timestamps (do not write directly as client-controlled values)
-- ============================================================================
CREATE FUNCTION public.set_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
CREATE TRIGGER production_capacity_updated_at BEFORE UPDATE ON public.production_capacity
    FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON public.campaigns
    FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
CREATE TRIGGER campaign_tasks_updated_at BEFORE UPDATE ON public.campaign_tasks
    FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
CREATE TRIGGER campaign_contents_updated_at BEFORE UPDATE ON public.campaign_contents
    FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
CREATE TRIGGER capacity_reservations_updated_at BEFORE UPDATE ON public.capacity_reservations
    FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();

-- ============================================================================
-- 8. RLS: owner can READ rows in own business; no direct client write policies.
-- Authenticated client cannot INSERT/UPDATE/DELETE any of these tables by default.
-- All writes must go through Next.js server-side use cases with checked auth &
-- tenant ownership, using privileged Supabase credentials ONLY on the server.
-- ============================================================================
CREATE FUNCTION public.is_business_owner(target_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.business_members AS bm
        WHERE bm.business_id = target_business_id
          AND bm.user_id = (SELECT auth.uid())
          AND bm.role = 'owner'
    );
$$;

REVOKE ALL ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_business_owner(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_row_updated_at() FROM PUBLIC;

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capacity_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY businesses_owner_read ON public.businesses
    FOR SELECT TO authenticated USING (public.is_business_owner(id));
CREATE POLICY business_members_owner_read ON public.business_members
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY products_owner_read ON public.products
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY production_capacity_owner_read ON public.production_capacity
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY campaigns_owner_read ON public.campaigns
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY ai_generations_owner_read ON public.ai_generations
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY campaign_blueprints_owner_read ON public.campaign_blueprints
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY campaign_tasks_owner_read ON public.campaign_tasks
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY campaign_contents_owner_read ON public.campaign_contents
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY orders_owner_read ON public.orders
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY order_items_owner_read ON public.order_items
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY capacity_reservations_owner_read ON public.capacity_reservations
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY order_events_owner_read ON public.order_events
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY payments_owner_read ON public.payments
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY payment_events_owner_read ON public.payment_events
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY campaign_costs_owner_read ON public.campaign_costs
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));
CREATE POLICY campaign_evaluations_owner_read ON public.campaign_evaluations
    FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

-- Defense in depth: authenticated users have read-only table privileges;
-- RLS still determines WHICH tenant rows are readable. Backend service role
-- performs authorized writes; never ship privileged keys to the client.
REVOKE ALL ON TABLE
    public.businesses, public.business_members, public.products,
    public.production_capacity, public.campaigns, public.ai_generations,
    public.campaign_blueprints, public.campaign_tasks, public.campaign_contents,
    public.orders, public.order_items, public.capacity_reservations,
    public.order_events, public.payments, public.payment_events,
    public.campaign_costs, public.campaign_evaluations
FROM anon, authenticated;
GRANT SELECT ON TABLE
    public.businesses, public.business_members, public.products,
    public.production_capacity, public.campaigns, public.ai_generations,
    public.campaign_blueprints, public.campaign_tasks, public.campaign_contents,
    public.orders, public.order_items, public.capacity_reservations,
    public.order_events, public.payments, public.payment_events,
    public.campaign_costs, public.campaign_evaluations
TO authenticated;

-- No anonymous SELECT policies. Public catalog, preorder, and order tracking
-- must use vetted Next.js routes returning minimal non-sensitive fields.
COMMIT;
