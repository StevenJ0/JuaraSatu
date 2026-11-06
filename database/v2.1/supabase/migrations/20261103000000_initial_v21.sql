-- Campaign Lab v2.1 fresh baseline. ONLY for an empty, isolated database.
-- Not an upgrade of the legacy chain; do not append to root supabase/migrations.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
DO $$ BEGIN
 IF (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector') <> 'extensions' THEN
  RAISE EXCEPTION 'vector must be installed in extensions';
 END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public, extensions TO authenticated, service_role;

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  slug varchar(140) NOT NULL,
  category varchar(80) NOT NULL,
  description text,
  public_contact varchar(120),
  pickup_instructions text NOT NULL,
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Jakarta',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.business_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  name varchar(160) NOT NULL,
  sku varchar(80) NOT NULL,
  description text,
  photo_path text,
  base_price_idr bigint NOT NULL CHECK (base_price_idr > 0),
  variable_cost_idr bigint CHECK (variable_cost_idr >= 0),
  cost_quality text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.production_capacity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  product_id uuid NOT NULL,
  fulfillment_date date NOT NULL,
  total_units integer NOT NULL CHECK (total_units >= 0),
  intake_cutoff_at timestamptz NOT NULL,
  fulfillment_window_end_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.preorders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  name varchar(160) NOT NULL,
  slug varchar(160),
  status text NOT NULL,
  fulfillment_date date NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  published_at timestamptz,
  closed_at timestamptz,
  completed_at timestamptz,
  pickup_terms_snapshot jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.preorder_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  preorder_id uuid NOT NULL,
  product_id uuid NOT NULL,
  capacity_id uuid NOT NULL,
  target_units integer NOT NULL CHECK (target_units > 0),
  quota_units integer NOT NULL CHECK (quota_units > 0),
  base_price_snapshot_idr bigint NOT NULL CHECK (base_price_snapshot_idr > 0),
  product_name_snapshot varchar(160) NOT NULL,
  sku_snapshot varchar(80) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  preorder_id uuid NOT NULL,
  name varchar(160) NOT NULL,
  slug varchar(160),
  status text NOT NULL,
  offer_type text NOT NULL,
  marketing_approach text NOT NULL,
  discount_bps integer NOT NULL DEFAULT 0 CHECK (discount_bps >= 0),
  budget_cap_idr bigint NOT NULL CHECK (budget_cap_idr >= 0),
  primary_kpi text NOT NULL,
  target_additional_units integer NOT NULL CHECK (target_additional_units > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  published_at timestamptz,
  closed_at timestamptz,
  completed_at timestamptz,
  active_blueprint_id uuid,
  published_blueprint_id uuid,
  baseline_json jsonb,
  baseline_calculated_at timestamptz,
  metrics_schema_version integer CHECK (metrics_schema_version > 0),
  costs_completeness text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.campaign_ai_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  preorder_id uuid NOT NULL,
  campaign_id uuid,
  status text NOT NULL,
  summary_text text,
  context_version_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.campaign_ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  session_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  role text NOT NULL,
  body_text text NOT NULL,
  proposal_json jsonb,
  context_hash text,
  ai_generation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  preorder_id uuid,
  campaign_id uuid,
  session_id uuid,
  generation_type text NOT NULL,
  request_key text NOT NULL,
  input_hash text NOT NULL,
  model_id text NOT NULL,
  status text NOT NULL,
  output_json jsonb,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.campaign_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  approval_status text NOT NULL,
  blueprint_json jsonb NOT NULL,
  source_ai_generation_id uuid,
  context_hash text NOT NULL,
  approved_by_user_id uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.campaign_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  blueprint_id uuid NOT NULL,
  task_key text NOT NULL,
  title text NOT NULL,
  description text,
  channel text,
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.campaign_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  blueprint_id uuid NOT NULL,
  content_key text NOT NULL,
  channel text NOT NULL,
  content_type text NOT NULL,
  body text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  preorder_id uuid,
  attribution_campaign_id uuid,
  pricing_campaign_id uuid,
  public_order_number text NOT NULL,
  private_token_hash text,
  idempotency_key text,
  request_hash text,
  source text NOT NULL,
  customer_name text NOT NULL,
  customer_email text,
  customer_contact text,
  fulfillment_date date NOT NULL,
  payment_mode text NOT NULL,
  external_payment_status text,
  external_payment_confirmed_at timestamptz,
  order_status text NOT NULL,
  fulfillment_status text NOT NULL,
  subtotal_idr bigint NOT NULL CHECK (subtotal_idr >= 0),
  discount_total_idr bigint NOT NULL CHECK (discount_total_idr >= 0),
  total_idr bigint NOT NULL CHECK (total_idr >= 0),
  payment_due_at timestamptz,
  confirmed_at timestamptz,
  production_started_at timestamptz,
  ready_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  review_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  order_id uuid NOT NULL,
  preorder_item_id uuid,
  product_id uuid NOT NULL,
  product_name_snapshot text NOT NULL,
  sku_snapshot text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  base_unit_price_idr bigint NOT NULL CHECK (base_unit_price_idr >= 0),
  discount_bps_snapshot integer NOT NULL CHECK (discount_bps_snapshot >= 0),
  discount_per_unit_idr bigint NOT NULL CHECK (discount_per_unit_idr >= 0),
  final_unit_price_idr bigint NOT NULL CHECK (final_unit_price_idr >= 0),
  variable_cost_per_unit_idr bigint CHECK (variable_cost_per_unit_idr >= 0),
  cost_quality_snapshot text NOT NULL,
  line_total_idr bigint NOT NULL CHECK (line_total_idr >= 0),
  pricing_campaign_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.capacity_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_item_id uuid NOT NULL,
  preorder_item_id uuid,
  capacity_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  state text NOT NULL,
  expires_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  order_id uuid NOT NULL,
  command_key text,
  event_type text NOT NULL,
  from_state text,
  to_state text,
  actor_type text NOT NULL,
  actor_user_id uuid,
  details_json jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.order_production_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  order_item_id uuid NOT NULL,
  cost_kind text NOT NULL,
  quantity integer NOT NULL CHECK (quantity >= 0),
  cost_per_unit_idr bigint CHECK (cost_per_unit_idr >= 0),
  amount_idr bigint CHECK (amount_idr >= 0),
  quality text NOT NULL,
  incurred_at timestamptz NOT NULL,
  resolved_by_user_id uuid,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  order_id uuid NOT NULL,
  provider text NOT NULL,
  provider_order_id text NOT NULL,
  provider_transaction_id text,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  amount_idr bigint NOT NULL CHECK (amount_idr >= 0),
  status text NOT NULL,
  is_active_attempt boolean NOT NULL,
  qr_content text,
  qr_expires_at timestamptz,
  provider_paid_at timestamptz,
  verified_at timestamptz,
  applied_at timestamptz,
  review_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  provider_event_key text NOT NULL,
  payload_hash text NOT NULL,
  provider_status text NOT NULL,
  signature_valid boolean NOT NULL,
  verified_at timestamptz NOT NULL,
  processed_at timestamptz,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.campaign_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  category text NOT NULL,
  description text,
  amount_idr bigint NOT NULL CHECK (amount_idr >= 0),
  incurred_at timestamptz NOT NULL,
  voided_at timestamptz,
  void_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.campaign_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  blueprint_id uuid NOT NULL,
  metrics_schema_version integer NOT NULL CHECK (metrics_schema_version > 0),
  metrics_json jsonb NOT NULL,
  analysis_json jsonb,
  limitations_json jsonb NOT NULL,
  source_ai_generation_id uuid,
  evaluation_kind text NOT NULL,
  calculated_at timestamptz NOT NULL,
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.campaign_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  source_evaluation_id uuid NOT NULL,
  source_blueprint_id uuid,
  source_version integer NOT NULL CHECK (source_version > 0),
  summary_text text NOT NULL,
  lessons_json jsonb NOT NULL,
  limitations_json jsonb NOT NULL,
  content_hash text NOT NULL,
  review_status text NOT NULL,
  embedding_status text NOT NULL,
  embedding extensions.vector(768),
  embedding_model text,
  embedding_profile text,
  embedding_version integer NOT NULL CHECK (embedding_version > 0),
  approved_at timestamptz,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE TABLE public.job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  entity_id uuid,
  business_id uuid,
  dedupe_key text NOT NULL,
  status text NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  next_run_at timestamptz NOT NULL,
  locked_until timestamptz,
  last_error_code text,
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE public.rate_limit_buckets (
  bucket_key_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_key_hash, window_start)
);

CREATE TABLE public.domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  command_key text,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_user_id uuid,
  safe_details_json jsonb,
  occurred_at timestamptz NOT NULL
);

ALTER TABLE public.business_members ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.products ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.production_capacity ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.preorders ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.preorder_items ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.campaigns ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_ai_sessions ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_ai_messages ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.ai_generations ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_blueprints ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_tasks ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_contents ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.orders ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.order_items ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.capacity_reservations ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.order_events ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.order_production_costs ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.payments ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.payment_events ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_costs ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_evaluations ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_memories ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.job_runs ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.domain_events ADD FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE RESTRICT;
ALTER TABLE public.business_members ADD FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_blueprints ADD FOREIGN KEY (approved_by_user_id) REFERENCES auth.users (id) ON DELETE RESTRICT;
ALTER TABLE public.order_events ADD FOREIGN KEY (actor_user_id) REFERENCES auth.users (id) ON DELETE RESTRICT;
ALTER TABLE public.order_production_costs ADD FOREIGN KEY (resolved_by_user_id) REFERENCES auth.users (id) ON DELETE RESTRICT;
ALTER TABLE public.domain_events ADD FOREIGN KEY (actor_user_id) REFERENCES auth.users (id) ON DELETE RESTRICT;
ALTER TABLE public.businesses ADD UNIQUE (slug);
ALTER TABLE public.business_members ADD UNIQUE (user_id);
ALTER TABLE public.business_members ADD UNIQUE (business_id);
ALTER TABLE public.products ADD UNIQUE (business_id, sku);
ALTER TABLE public.production_capacity ADD UNIQUE (business_id, product_id, fulfillment_date);
ALTER TABLE public.production_capacity ADD UNIQUE (id, business_id, product_id);
ALTER TABLE public.preorder_items ADD UNIQUE (preorder_id);
ALTER TABLE public.preorder_items ADD UNIQUE (id, business_id, product_id);
ALTER TABLE public.campaigns ADD UNIQUE (slug);
ALTER TABLE public.campaigns ADD UNIQUE (id, business_id, preorder_id);
ALTER TABLE public.campaign_ai_sessions ADD UNIQUE (id, business_id, preorder_id);
ALTER TABLE public.ai_generations ADD UNIQUE (business_id, generation_type, request_key);
ALTER TABLE public.ai_generations ADD UNIQUE (id, business_id, session_id);
ALTER TABLE public.campaign_ai_messages ADD UNIQUE (session_id, sequence);
ALTER TABLE public.campaign_blueprints ADD UNIQUE (campaign_id, version);
ALTER TABLE public.campaign_blueprints ADD UNIQUE (id, business_id, campaign_id);
ALTER TABLE public.campaign_tasks ADD UNIQUE (blueprint_id, task_key);
ALTER TABLE public.campaign_contents ADD UNIQUE (blueprint_id, content_key);
ALTER TABLE public.orders ADD UNIQUE (public_order_number);
ALTER TABLE public.orders ADD UNIQUE (private_token_hash);
ALTER TABLE public.orders ADD UNIQUE (business_id, idempotency_key);
ALTER TABLE public.order_items ADD UNIQUE (id, business_id, order_id);
ALTER TABLE public.capacity_reservations ADD UNIQUE (order_item_id);
ALTER TABLE public.payments ADD UNIQUE (provider_order_id);
ALTER TABLE public.payments ADD UNIQUE (provider_transaction_id);
ALTER TABLE public.payments ADD UNIQUE (order_id, attempt_number);
ALTER TABLE public.payment_events ADD UNIQUE (payment_id, provider_event_key);
ALTER TABLE public.order_production_costs ADD UNIQUE (order_item_id, cost_kind);
ALTER TABLE public.campaign_evaluations ADD UNIQUE (id, business_id, campaign_id);
ALTER TABLE public.campaign_memories ADD UNIQUE (business_id, source_evaluation_id, source_version);
ALTER TABLE public.job_runs ADD UNIQUE (job_type, dedupe_key);
ALTER TABLE public.production_capacity ADD FOREIGN KEY (product_id, business_id) REFERENCES public.products (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.preorder_items ADD FOREIGN KEY (preorder_id, business_id) REFERENCES public.preorders (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.preorder_items ADD FOREIGN KEY (product_id, business_id) REFERENCES public.products (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.preorder_items ADD FOREIGN KEY (capacity_id, business_id, product_id) REFERENCES public.production_capacity (id, business_id, product_id) ON DELETE RESTRICT;
ALTER TABLE public.campaigns ADD FOREIGN KEY (preorder_id, business_id) REFERENCES public.preorders (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_ai_sessions ADD FOREIGN KEY (preorder_id, business_id) REFERENCES public.preorders (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_ai_sessions ADD FOREIGN KEY (campaign_id, business_id, preorder_id) REFERENCES public.campaigns (id, business_id, preorder_id) ON DELETE RESTRICT;
ALTER TABLE public.ai_generations ADD FOREIGN KEY (preorder_id, business_id) REFERENCES public.preorders (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.ai_generations ADD FOREIGN KEY (campaign_id, business_id, preorder_id) REFERENCES public.campaigns (id, business_id, preorder_id) ON DELETE RESTRICT;
ALTER TABLE public.ai_generations ADD FOREIGN KEY (session_id, business_id, preorder_id) REFERENCES public.campaign_ai_sessions (id, business_id, preorder_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_ai_messages ADD FOREIGN KEY (session_id, business_id) REFERENCES public.campaign_ai_sessions (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_ai_messages ADD FOREIGN KEY (ai_generation_id, business_id, session_id) REFERENCES public.ai_generations (id, business_id, session_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_blueprints ADD FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_blueprints ADD FOREIGN KEY (source_ai_generation_id, business_id) REFERENCES public.ai_generations (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaigns ADD FOREIGN KEY (active_blueprint_id, business_id, id) REFERENCES public.campaign_blueprints (id, business_id, campaign_id) ON DELETE RESTRICT;
ALTER TABLE public.campaigns ADD FOREIGN KEY (published_blueprint_id, business_id, id) REFERENCES public.campaign_blueprints (id, business_id, campaign_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_tasks ADD FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_tasks ADD FOREIGN KEY (blueprint_id, business_id, campaign_id) REFERENCES public.campaign_blueprints (id, business_id, campaign_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_contents ADD FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_contents ADD FOREIGN KEY (blueprint_id, business_id, campaign_id) REFERENCES public.campaign_blueprints (id, business_id, campaign_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_evaluations ADD FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_evaluations ADD FOREIGN KEY (blueprint_id, business_id, campaign_id) REFERENCES public.campaign_blueprints (id, business_id, campaign_id) ON DELETE RESTRICT;
ALTER TABLE public.orders ADD FOREIGN KEY (preorder_id, business_id) REFERENCES public.preorders (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.orders ADD FOREIGN KEY (attribution_campaign_id, business_id, preorder_id) REFERENCES public.campaigns (id, business_id, preorder_id) ON DELETE RESTRICT;
ALTER TABLE public.orders ADD FOREIGN KEY (pricing_campaign_id, business_id, preorder_id) REFERENCES public.campaigns (id, business_id, preorder_id) ON DELETE RESTRICT;
ALTER TABLE public.order_items ADD FOREIGN KEY (order_id, business_id) REFERENCES public.orders (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.order_items ADD FOREIGN KEY (product_id, business_id) REFERENCES public.products (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.order_items ADD FOREIGN KEY (preorder_item_id, business_id, product_id) REFERENCES public.preorder_items (id, business_id, product_id) ON DELETE RESTRICT;
ALTER TABLE public.order_items ADD FOREIGN KEY (pricing_campaign_id, business_id) REFERENCES public.campaigns (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.capacity_reservations ADD FOREIGN KEY (order_item_id, business_id, order_id) REFERENCES public.order_items (id, business_id, order_id) ON DELETE RESTRICT;
ALTER TABLE public.capacity_reservations ADD FOREIGN KEY (capacity_id, business_id) REFERENCES public.production_capacity (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.capacity_reservations ADD FOREIGN KEY (preorder_item_id, business_id) REFERENCES public.preorder_items (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.order_events ADD FOREIGN KEY (order_id, business_id) REFERENCES public.orders (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.payments ADD FOREIGN KEY (order_id, business_id) REFERENCES public.orders (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.order_production_costs ADD FOREIGN KEY (order_item_id, business_id) REFERENCES public.order_items (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.payment_events ADD FOREIGN KEY (payment_id, business_id) REFERENCES public.payments (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_costs ADD FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_evaluations ADD FOREIGN KEY (source_ai_generation_id, business_id) REFERENCES public.ai_generations (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_memories ADD FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns (id, business_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_memories ADD FOREIGN KEY (source_evaluation_id, business_id, campaign_id) REFERENCES public.campaign_evaluations (id, business_id, campaign_id) ON DELETE RESTRICT;
ALTER TABLE public.campaign_memories ADD FOREIGN KEY (source_blueprint_id, business_id, campaign_id) REFERENCES public.campaign_blueprints (id, business_id, campaign_id) ON DELETE RESTRICT;
ALTER TABLE public.business_members ADD CHECK (role IN ('owner'));
ALTER TABLE public.products ADD CHECK (cost_quality IN ('unknown','estimated','verified'));
ALTER TABLE public.preorders ADD CHECK (status IN ('draft','published','closed','completed','cancelled'));
ALTER TABLE public.campaigns ADD CHECK (status IN ('draft','published','closed','completed','cancelled'));
ALTER TABLE public.campaigns ADD CHECK (offer_type IN ('normal_price','percent_discount'));
ALTER TABLE public.campaigns ADD CHECK (marketing_approach IN ('scheduled_reminder','value_content','limited_discount'));
ALTER TABLE public.campaigns ADD CHECK (primary_kpi IN ('paid_units_in_window'));
ALTER TABLE public.campaigns ADD CHECK (costs_completeness IN ('unreviewed','confirmed_complete'));
ALTER TABLE public.campaign_ai_sessions ADD CHECK (status IN ('active','closed'));
ALTER TABLE public.campaign_ai_messages ADD CHECK (role IN ('user','assistant'));
ALTER TABLE public.ai_generations ADD CHECK (generation_type IN ('strategies','discussion','blueprint','evaluation'));
ALTER TABLE public.ai_generations ADD CHECK (status IN ('running','success','failed','invalid_output'));
ALTER TABLE public.campaign_blueprints ADD CHECK (approval_status IN ('proposed','approved','discarded'));
ALTER TABLE public.campaign_tasks ADD CHECK (channel IN ('whatsapp','instagram','offline'));
ALTER TABLE public.campaign_contents ADD CHECK (channel IN ('whatsapp','instagram','landing_page'));
ALTER TABLE public.campaign_contents ADD CHECK (content_type IN ('headline','caption','cta'));
ALTER TABLE public.orders ADD CHECK (source IN ('public','manual'));
ALTER TABLE public.orders ADD CHECK (payment_mode IN ('midtrans_sandbox','external_manual'));
ALTER TABLE public.orders ADD CHECK (order_status IN ('pending_payment','awaiting_confirmation','active','expired','cancelled','requires_review'));
ALTER TABLE public.orders ADD CHECK (fulfillment_status IN ('pending_confirmation','confirmed','in_production','ready','fulfilled','cancelled'));
ALTER TABLE public.order_items ADD CHECK (cost_quality_snapshot IN ('unknown','estimated','verified'));
ALTER TABLE public.capacity_reservations ADD CHECK (state IN ('held','allocated','released'));
ALTER TABLE public.order_events ADD CHECK (actor_type IN ('owner','system','provider'));
ALTER TABLE public.order_production_costs ADD CHECK (cost_kind IN ('variable_production'));
ALTER TABLE public.order_production_costs ADD CHECK (quality IN ('unknown','estimated','verified'));
ALTER TABLE public.payments ADD CHECK (provider IN ('midtrans_sandbox'));
ALTER TABLE public.payments ADD CHECK (status IN ('initiating','pending','paid_sandbox','expired','failed','cancelled'));
ALTER TABLE public.campaign_costs ADD CHECK (category IN ('advertising','printing','other'));
ALTER TABLE public.campaign_evaluations ADD CHECK (evaluation_kind IN ('provisional','final'));
ALTER TABLE public.campaign_memories ADD CHECK (review_status IN ('draft','approved'));
ALTER TABLE public.campaign_memories ADD CHECK (embedding_status IN ('queued','ready','failed','stale'));
ALTER TABLE public.job_runs ADD CHECK (job_type IN ('expire','reconcile','embed_memory','send_paid_email'));
ALTER TABLE public.job_runs ADD CHECK (status IN ('queued','running','succeeded','retryable_failed','dead'));
ALTER TABLE public.businesses ADD CHECK (length(btrim(name)) > 0 AND length(btrim(slug)) > 0);
ALTER TABLE public.products ADD CHECK ((cost_quality='unknown') = (variable_cost_idr IS NULL));
ALTER TABLE public.products ADD CHECK (length(btrim(name)) > 0 AND length(btrim(sku)) > 0);
ALTER TABLE public.production_capacity ADD CHECK (intake_cutoff_at < fulfillment_window_end_at);
ALTER TABLE public.preorders ADD CHECK (starts_at < ends_at);
ALTER TABLE public.preorders ADD CHECK (status <> 'published' OR (published_at IS NOT NULL AND slug IS NOT NULL));
ALTER TABLE public.preorder_items ADD CHECK (quota_units >= target_units);
ALTER TABLE public.campaigns ADD CHECK (starts_at < ends_at);
ALTER TABLE public.campaigns ADD CHECK ((offer_type='normal_price' AND discount_bps=0 AND marketing_approach<>'limited_discount') OR (offer_type='percent_discount' AND discount_bps BETWEEN 1 AND 9999 AND marketing_approach='limited_discount'));
ALTER TABLE public.campaigns ADD CHECK (status <> 'published' OR (published_at IS NOT NULL AND active_blueprint_id IS NOT NULL AND published_blueprint_id=active_blueprint_id AND baseline_json IS NOT NULL AND baseline_calculated_at IS NOT NULL AND metrics_schema_version IS NOT NULL AND slug IS NOT NULL));
ALTER TABLE public.ai_generations ADD CHECK ((campaign_id IS NULL AND session_id IS NULL) OR preorder_id IS NOT NULL);
ALTER TABLE public.ai_generations ADD CHECK (length(request_key) BETWEEN 1 AND 128);
ALTER TABLE public.ai_generations ADD CHECK (status <> 'success' OR (output_json IS NOT NULL AND finished_at IS NOT NULL));
ALTER TABLE public.ai_generations ADD CHECK (status <> 'running' OR started_at IS NOT NULL);
ALTER TABLE public.campaign_ai_messages ADD CHECK (length(body_text) BETWEEN 1 AND 4000);
ALTER TABLE public.campaign_ai_messages ADD CHECK (role='assistant' OR proposal_json IS NULL);
ALTER TABLE public.campaign_ai_sessions ADD CHECK (summary_text IS NULL OR length(summary_text) <= 12000);
ALTER TABLE public.campaign_blueprints ADD CHECK (approval_status<>'approved' OR (approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL));
ALTER TABLE public.campaign_tasks ADD CHECK (length(title) BETWEEN 1 AND 160);
ALTER TABLE public.campaign_contents ADD CHECK (length(body) BETWEEN 1 AND 2200);
ALTER TABLE public.orders ADD CHECK (source<>'public' OR (preorder_id IS NOT NULL AND private_token_hash IS NOT NULL AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL AND customer_email IS NOT NULL));
ALTER TABLE public.orders ADD CHECK ((attribution_campaign_id IS NULL AND pricing_campaign_id IS NULL) OR preorder_id IS NOT NULL);
ALTER TABLE public.orders ADD CHECK (total_idr=subtotal_idr-discount_total_idr AND total_idr>0);
ALTER TABLE public.orders ADD CHECK (customer_email IS NULL OR (length(customer_email) <= 254 AND customer_email=lower(btrim(customer_email)) AND customer_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'));
ALTER TABLE public.order_items ADD CHECK ((cost_quality_snapshot='unknown') = (variable_cost_per_unit_idr IS NULL));
ALTER TABLE public.order_items ADD CHECK (base_unit_price_idr>0 AND final_unit_price_idr>0);
ALTER TABLE public.order_items ADD CHECK (discount_bps_snapshot BETWEEN 0 AND 9999);
ALTER TABLE public.order_items ADD CHECK (discount_per_unit_idr=floor(base_unit_price_idr::numeric*discount_bps_snapshot/10000));
ALTER TABLE public.order_items ADD CHECK (final_unit_price_idr=base_unit_price_idr-discount_per_unit_idr);
ALTER TABLE public.order_items ADD CHECK (line_total_idr=final_unit_price_idr::numeric*quantity);
ALTER TABLE public.capacity_reservations ADD CHECK (state<>'held' OR expires_at IS NOT NULL);
ALTER TABLE public.capacity_reservations ADD CHECK (state<>'released' OR released_at IS NOT NULL);
ALTER TABLE public.order_production_costs ADD CHECK ((quality='unknown') = (cost_per_unit_idr IS NULL));
ALTER TABLE public.order_production_costs ADD CHECK ((cost_per_unit_idr IS NULL) = (amount_idr IS NULL));
ALTER TABLE public.order_production_costs ADD CHECK (amount_idr=cost_per_unit_idr::numeric*quantity);
ALTER TABLE public.payments ADD CHECK (amount_idr>0);
ALTER TABLE public.payments ADD CHECK (applied_at IS NULL OR (status='paid_sandbox' AND verified_at IS NOT NULL AND provider_paid_at IS NOT NULL));
ALTER TABLE public.campaign_memories ADD CHECK (review_status<>'approved' OR approved_at IS NOT NULL);
ALTER TABLE public.campaign_memories ADD CHECK (embedding_status<>'ready' OR (review_status='approved' AND embedding IS NOT NULL AND embedding_model IS NOT NULL AND embedding_profile IS NOT NULL AND indexed_at IS NOT NULL));
ALTER TABLE public.campaign_ai_sessions ADD CHECK (context_version_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.campaign_ai_messages ADD CHECK (context_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.ai_generations ADD CHECK (input_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.campaign_blueprints ADD CHECK (context_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.orders ADD CHECK (private_token_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.orders ADD CHECK (request_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.payment_events ADD CHECK (payload_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.campaign_memories ADD CHECK (content_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.rate_limit_buckets ADD CHECK (bucket_key_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.preorders ADD CHECK (jsonb_typeof(pickup_terms_snapshot)='object');
ALTER TABLE public.campaigns ADD CHECK (jsonb_typeof(baseline_json)='object');
ALTER TABLE public.campaign_ai_messages ADD CHECK (jsonb_typeof(proposal_json)='object');
ALTER TABLE public.ai_generations ADD CHECK (jsonb_typeof(output_json)='object');
ALTER TABLE public.campaign_blueprints ADD CHECK (jsonb_typeof(blueprint_json)='object');
ALTER TABLE public.order_events ADD CHECK (jsonb_typeof(details_json)='object');
ALTER TABLE public.campaign_evaluations ADD CHECK (jsonb_typeof(metrics_json)='object');
ALTER TABLE public.campaign_evaluations ADD CHECK (jsonb_typeof(analysis_json)='object');
ALTER TABLE public.domain_events ADD CHECK (jsonb_typeof(safe_details_json)='object');
ALTER TABLE public.campaign_evaluations ADD CHECK (jsonb_typeof(limitations_json)='array');
ALTER TABLE public.campaign_memories ADD CHECK (jsonb_typeof(limitations_json)='array');
CREATE UNIQUE INDEX preorders_one_published ON public.preorders (business_id, fulfillment_date) WHERE status='published';
CREATE UNIQUE INDEX campaigns_one_published ON public.campaigns (preorder_id) WHERE status='published';
CREATE UNIQUE INDEX blueprints_one_approved ON public.campaign_blueprints (campaign_id) WHERE approval_status='approved';
CREATE UNIQUE INDEX ai_one_running_session ON public.ai_generations (session_id) WHERE status='running' AND session_id IS NOT NULL;
CREATE UNIQUE INDEX messages_generation_role ON public.campaign_ai_messages (ai_generation_id, role) WHERE ai_generation_id IS NOT NULL;
CREATE UNIQUE INDEX payments_one_active ON public.payments (order_id) WHERE is_active_attempt;
CREATE UNIQUE INDEX payments_one_applied ON public.payments (order_id) WHERE applied_at IS NOT NULL;
CREATE UNIQUE INDEX order_events_command ON public.order_events (business_id, command_key) WHERE command_key IS NOT NULL;
CREATE UNIQUE INDEX domain_events_command ON public.domain_events (business_id, entity_type, entity_id, event_type, command_key) WHERE command_key IS NOT NULL;
CREATE INDEX products_read_0 ON public.products (business_id, is_active);
CREATE INDEX preorders_read_0 ON public.preorders (business_id, status, created_at);
CREATE INDEX campaigns_read_0 ON public.campaigns (preorder_id, status);
CREATE INDEX campaign_ai_sessions_read_0 ON public.campaign_ai_sessions (business_id, preorder_id, created_at);
CREATE INDEX capacity_reservations_read_0 ON public.capacity_reservations (capacity_id, state, expires_at);
CREATE INDEX capacity_reservations_read_1 ON public.capacity_reservations (preorder_item_id, state, expires_at);
CREATE INDEX orders_read_0 ON public.orders (business_id, preorder_id, created_at);
CREATE INDEX order_events_read_0 ON public.order_events (order_id, occurred_at);
CREATE INDEX payments_read_0 ON public.payments (business_id, order_id, status);
CREATE INDEX campaign_evaluations_read_0 ON public.campaign_evaluations (business_id, campaign_id, calculated_at);
CREATE INDEX campaign_memories_read_0 ON public.campaign_memories (business_id, review_status, embedding_status, embedding_model, embedding_profile);
CREATE INDEX job_runs_read_0 ON public.job_runs (status, next_run_at);

-- INTEGRITY_AND_FUNCTIONS

CREATE FUNCTION public.is_business_owner(target_business_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.business_members m
 WHERE m.business_id=target_business_id AND m.user_id=auth.uid() AND m.role='owner');
$$;

CREATE FUNCTION private.require_owner(p_business_id uuid, p_actor_user_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
 IF auth.role()='service_role' THEN actor:=p_actor_user_id;
 ELSIF p_actor_user_id IS NOT NULL AND p_actor_user_id IS DISTINCT FROM actor THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.business_members
  WHERE business_id=p_business_id AND user_id=actor AND role='owner') THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

CREATE FUNCTION private.touch_row() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 NEW.updated_at:=clock_timestamp();
 IF to_jsonb(NEW) ? 'version' THEN
  IF NEW.version=OLD.version THEN NEW.version:=OLD.version+1;
  ELSIF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION private.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY' USING ERRCODE='23514'; END $$;
CREATE FUNCTION private.guard_preorder_item() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE cap public.production_capacity; po public.preorders;
BEGIN
 SELECT * INTO STRICT cap FROM public.production_capacity WHERE id=NEW.capacity_id FOR UPDATE;
 SELECT * INTO STRICT po FROM public.preorders WHERE id=NEW.preorder_id;
 IF cap.business_id<>NEW.business_id OR cap.product_id<>NEW.product_id OR
  cap.fulfillment_date<>po.fulfillment_date OR NEW.quota_units>cap.total_units OR po.ends_at>cap.intake_cutoff_at THEN
  RAISE EXCEPTION 'PREORDER_CAPACITY_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF NEW.quota_units<(SELECT coalesce(sum(quantity),0) FROM public.capacity_reservations WHERE preorder_item_id=NEW.id
  AND (state='allocated' OR (state='held' AND expires_at>clock_timestamp()))) THEN
  RAISE EXCEPTION 'QUOTA_IN_USE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND po.published_at IS NOT NULL AND
  (NEW.base_price_snapshot_idr,NEW.product_id,NEW.capacity_id,NEW.product_name_snapshot,NEW.sku_snapshot,NEW.preorder_id,NEW.business_id)
  IS DISTINCT FROM (OLD.base_price_snapshot_idr,OLD.product_id,OLD.capacity_id,OLD.product_name_snapshot,OLD.sku_snapshot,OLD.preorder_id,OLD.business_id) THEN
  RAISE EXCEPTION 'FROZEN_PREORDER_SNAPSHOT' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preorder_item_guard BEFORE INSERT OR UPDATE ON public.preorder_items
FOR EACH ROW EXECUTE FUNCTION private.guard_preorder_item();

CREATE FUNCTION private.guard_preorder() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.published_at IS NOT NULL AND
  (NEW.business_id,NEW.fulfillment_date,NEW.starts_at,NEW.ends_at,NEW.pickup_terms_snapshot)
  IS DISTINCT FROM (OLD.business_id,OLD.fulfillment_date,OLD.starts_at,OLD.ends_at,OLD.pickup_terms_snapshot) THEN
  RAISE EXCEPTION 'FROZEN_PREORDER' USING ERRCODE='23514';
 END IF;
 IF NEW.status='published' AND (SELECT count(*) FROM public.preorder_items WHERE preorder_id=NEW.id)<>1 THEN
  RAISE EXCEPTION 'PUBLISHED_PREORDER_REQUIRES_ONE_ITEM' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preorder_guard BEFORE INSERT OR UPDATE ON public.preorders
FOR EACH ROW EXECUTE FUNCTION private.guard_preorder();

CREATE FUNCTION private.guard_capacity() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE used bigint;
BEGIN
 SELECT coalesce(sum(quantity),0) INTO used FROM public.capacity_reservations
 WHERE capacity_id=OLD.id AND (state='allocated' OR (state='held' AND expires_at>clock_timestamp()));
 IF NEW.total_units<used OR EXISTS (SELECT 1 FROM public.preorder_items i JOIN public.preorders p ON p.id=i.preorder_id
  WHERE i.capacity_id=OLD.id AND (i.quota_units>NEW.total_units OR i.product_id<>NEW.product_id OR
   p.fulfillment_date<>NEW.fulfillment_date OR p.ends_at>NEW.intake_cutoff_at)) THEN
  RAISE EXCEPTION 'CAPACITY_IN_USE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capacity_guard BEFORE UPDATE ON public.production_capacity
FOR EACH ROW EXECUTE FUNCTION private.guard_capacity();

CREATE FUNCTION private.guard_reservation() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE cap public.production_capacity; item public.order_items; ord public.orders;
 pi public.preorder_items; used bigint; event_used bigint; effective integer;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.capacity_id,NEW.order_item_id,NEW.order_id,NEW.business_id,NEW.preorder_item_id,NEW.quantity)
  IS DISTINCT FROM (OLD.capacity_id,OLD.order_item_id,OLD.order_id,OLD.business_id,OLD.preorder_item_id,OLD.quantity) THEN
  RAISE EXCEPTION 'RESERVATION_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 SELECT * INTO STRICT cap FROM public.production_capacity WHERE id=NEW.capacity_id FOR UPDATE;
 IF NEW.preorder_item_id IS NOT NULL THEN
  SELECT * INTO STRICT pi FROM public.preorder_items WHERE id=NEW.preorder_item_id FOR UPDATE;
 END IF;
 SELECT * INTO STRICT ord FROM public.orders WHERE id=NEW.order_id FOR UPDATE;
 SELECT * INTO STRICT item FROM public.order_items WHERE id=NEW.order_item_id;
 IF item.order_id<>ord.id OR item.business_id<>NEW.business_id OR cap.business_id<>NEW.business_id OR
  cap.product_id<>item.product_id OR cap.fulfillment_date<>ord.fulfillment_date OR item.quantity<>NEW.quantity OR
  item.preorder_item_id IS DISTINCT FROM NEW.preorder_item_id OR
  (NEW.preorder_item_id IS NOT NULL AND (pi.capacity_id<>cap.id OR pi.preorder_id IS DISTINCT FROM ord.preorder_id)) THEN
  RAISE EXCEPTION 'RESERVATION_SCOPE_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.state='allocated' AND NEW.state='released' AND ord.production_started_at IS NOT NULL THEN
  RAISE EXCEPTION 'SUNK_PRODUCTION_CAPACITY' USING ERRCODE='23514';
 END IF;
 effective:=CASE WHEN NEW.state='allocated' OR (NEW.state='held' AND NEW.expires_at>clock_timestamp()) THEN NEW.quantity ELSE 0 END;
 SELECT coalesce(sum(quantity),0) INTO used FROM public.capacity_reservations
 WHERE capacity_id=cap.id AND id<>NEW.id AND (state='allocated' OR (state='held' AND expires_at>clock_timestamp()));
 IF used+effective>cap.total_units THEN RAISE EXCEPTION 'CAPACITY_EXCEEDED' USING ERRCODE='23514'; END IF;
 IF NEW.preorder_item_id IS NOT NULL THEN
  SELECT coalesce(sum(quantity),0) INTO event_used FROM public.capacity_reservations
  WHERE preorder_item_id=pi.id AND id<>NEW.id AND (state='allocated' OR (state='held' AND expires_at>clock_timestamp()));
  IF event_used+effective>pi.quota_units THEN RAISE EXCEPTION 'QUOTA_EXCEEDED' USING ERRCODE='23514'; END IF;
 END IF;
 UPDATE public.production_capacity SET version=version+1 WHERE id=cap.id;
 RETURN NEW;
END $$;
CREATE TRIGGER reservation_guard BEFORE INSERT OR UPDATE ON public.capacity_reservations
FOR EACH ROW EXECUTE FUNCTION private.guard_reservation();

CREATE FUNCTION private.guard_order_items() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'IMMUTABLE_ORDER_SNAPSHOT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_item_snapshot BEFORE UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION private.guard_order_items();
CREATE FUNCTION private.check_order_totals() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE oid uuid; ord public.orders; n bigint; base numeric; discount numeric; total numeric;
BEGIN
  IF TG_TABLE_NAME='orders' THEN oid:=NEW.id; ELSE oid:=NEW.order_id; END IF;
 SELECT * INTO ord FROM public.orders WHERE id=oid;
 SELECT count(*),sum(quantity::numeric*base_unit_price_idr),sum(quantity::numeric*discount_per_unit_idr),sum(line_total_idr)
 INTO n,base,discount,total FROM public.order_items WHERE order_id=oid;
 IF n=0 OR (ord.source='public' AND n<>1) OR (base,discount,total) IS DISTINCT FROM
  (ord.subtotal_idr::numeric,ord.discount_total_idr::numeric,ord.total_idr::numeric) OR EXISTS (
   SELECT 1 FROM public.order_items i LEFT JOIN public.preorder_items p ON p.id=i.preorder_item_id
   WHERE i.order_id=oid AND (i.pricing_campaign_id IS DISTINCT FROM ord.pricing_campaign_id OR
    (ord.source='public' AND (p.preorder_id IS DISTINCT FROM ord.preorder_id OR
     i.base_unit_price_idr IS DISTINCT FROM p.base_price_snapshot_idr OR
     i.product_name_snapshot IS DISTINCT FROM p.product_name_snapshot OR i.sku_snapshot IS DISTINCT FROM p.sku_snapshot)))) THEN
  RAISE EXCEPTION 'ORDER_SNAPSHOT_TOTALS_MISMATCH' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER order_totals_header AFTER INSERT OR UPDATE ON public.orders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_order_totals();
CREATE CONSTRAINT TRIGGER order_totals_items AFTER INSERT ON public.order_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_order_totals();

CREATE FUNCTION private.guard_campaign() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE po public.preorders; bp public.campaign_blueprints;
BEGIN
 SELECT * INTO STRICT po FROM public.preorders WHERE id=NEW.preorder_id;
 IF NEW.starts_at<po.starts_at OR NEW.ends_at>po.ends_at THEN
  RAISE EXCEPTION 'CAMPAIGN_WINDOW_INVALID' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.published_at IS NOT NULL AND
  (NEW.preorder_id,NEW.business_id,NEW.offer_type,NEW.marketing_approach,NEW.discount_bps,NEW.budget_cap_idr,
   NEW.primary_kpi,NEW.target_additional_units,NEW.starts_at,NEW.ends_at,NEW.published_blueprint_id,NEW.active_blueprint_id)
  IS DISTINCT FROM (OLD.preorder_id,OLD.business_id,OLD.offer_type,OLD.marketing_approach,OLD.discount_bps,OLD.budget_cap_idr,
   OLD.primary_kpi,OLD.target_additional_units,OLD.starts_at,OLD.ends_at,OLD.published_blueprint_id,OLD.active_blueprint_id) THEN
  RAISE EXCEPTION 'PUBLISHED_CAMPAIGN_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NEW.status='published' THEN
  SELECT * INTO STRICT bp FROM public.campaign_blueprints WHERE id=NEW.published_blueprint_id;
  IF bp.approval_status<>'approved' OR po.status<>'published' THEN
   RAISE EXCEPTION 'APPROVED_BLUEPRINT_REQUIRED' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER campaign_guard BEFORE INSERT OR UPDATE ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION private.guard_campaign();

CREATE FUNCTION private.cost_changed() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 UPDATE public.campaigns SET costs_completeness='unreviewed' WHERE id=NEW.campaign_id;
 RETURN NEW;
END $$;
CREATE TRIGGER cost_changed AFTER INSERT OR UPDATE ON public.campaign_costs
FOR EACH ROW EXECUTE FUNCTION private.cost_changed();

DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='updated_at' LOOP
  EXECUTE format('CREATE TRIGGER touch_row BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.touch_row()',t.table_name);
 END LOOP;
END $$;

-- OPERATIONS

CREATE FUNCTION public.create_business_with_owner(p_name text, p_slug text, p_category text,
 p_pickup_instructions text, p_actor_user_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); bid uuid;
BEGIN
 IF auth.role()='service_role' THEN actor:=p_actor_user_id; END IF;
 IF actor IS NULL OR (auth.role()<>'service_role' AND p_actor_user_id IS NOT NULL AND p_actor_user_id<>actor) THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.businesses(name,slug,category,pickup_instructions) VALUES
 (btrim(p_name),btrim(p_slug),btrim(p_category),p_pickup_instructions) RETURNING id INTO bid;
 INSERT INTO public.business_members(business_id,user_id) VALUES(bid,actor);
 RETURN bid;
END $$;

CREATE FUNCTION public.create_ai_session(p_business_id uuid,p_preorder_id uuid,p_session_id uuid,
 p_context_hash text,p_actor_user_id uuid DEFAULT NULL) RETURNS public.campaign_ai_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.campaign_ai_sessions;
BEGIN
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 INSERT INTO public.campaign_ai_sessions(id,business_id,preorder_id,status,context_version_hash)
 VALUES(p_session_id,p_business_id,p_preorder_id,'active',p_context_hash) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO STRICT result FROM public.campaign_ai_sessions WHERE id=p_session_id FOR UPDATE;
 IF result.business_id<>p_business_id OR result.preorder_id<>p_preorder_id OR result.context_version_hash<>p_context_hash THEN
  RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.refresh_ai_session_context(p_business_id uuid,p_session_id uuid,p_expected_version integer,
 p_context_hash text,p_actor_user_id uuid DEFAULT NULL) RETURNS public.campaign_ai_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.campaign_ai_sessions;
BEGIN
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 SELECT * INTO STRICT result FROM public.campaign_ai_sessions WHERE id=p_session_id AND business_id=p_business_id FOR UPDATE;
 IF result.version<>p_expected_version OR result.status<>'active' THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.ai_generations WHERE session_id=p_session_id AND status='running') THEN
  RAISE EXCEPTION 'TURN_IN_PROGRESS' USING ERRCODE='40001'; END IF;
 UPDATE public.campaign_ai_sessions SET context_version_hash=p_context_hash WHERE id=p_session_id RETURNING * INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.claim_ai_generation(p_business_id uuid,p_session_id uuid,p_expected_version integer,
 p_context_hash text,p_request_key text,p_input_hash text,p_model_id text,p_message text,
 p_generation_type text DEFAULT 'discussion',p_actor_user_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE sess public.campaign_ai_sessions; gen public.ai_generations; seq integer;
BEGIN
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 IF p_generation_type NOT IN ('discussion','strategies') OR p_message IS NULL OR length(p_message) NOT BETWEEN 1 AND 4000 THEN
  RAISE EXCEPTION 'INVALID_DISCUSSION_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO STRICT sess FROM public.campaign_ai_sessions WHERE id=p_session_id AND business_id=p_business_id FOR UPDATE;
 SELECT * INTO gen FROM public.ai_generations WHERE business_id=p_business_id AND generation_type=p_generation_type AND request_key=p_request_key FOR UPDATE;
 IF FOUND THEN
  IF gen.session_id IS DISTINCT FROM p_session_id OR gen.input_hash<>p_input_hash OR
   NOT EXISTS(SELECT 1 FROM public.campaign_ai_messages WHERE ai_generation_id=gen.id AND role='user'
    AND body_text=p_message AND context_hash=p_context_hash) THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('status',gen.status,'generationId',gen.id,'output',gen.output_json,'errorCode',gen.error_code,'sessionVersion',sess.version);
 END IF;
 IF sess.version<>p_expected_version OR sess.status<>'active' THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF sess.context_version_hash<>p_context_hash THEN RAISE EXCEPTION 'STALE_CONTEXT' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.ai_generations WHERE session_id=p_session_id AND status='running') THEN
  RAISE EXCEPTION 'TURN_IN_PROGRESS' USING ERRCODE='40001'; END IF;
 INSERT INTO public.ai_generations(business_id,preorder_id,session_id,campaign_id,generation_type,request_key,
  input_hash,model_id,status,started_at) VALUES(p_business_id,sess.preorder_id,p_session_id,sess.campaign_id,
  p_generation_type,p_request_key,p_input_hash,p_model_id,'running',clock_timestamp()) RETURNING * INTO gen;
 SELECT coalesce(max(sequence),0)+1 INTO seq FROM public.campaign_ai_messages WHERE session_id=p_session_id;
 INSERT INTO public.campaign_ai_messages(business_id,session_id,sequence,role,body_text,context_hash,ai_generation_id)
 VALUES(p_business_id,p_session_id,seq,'user',p_message,p_context_hash,gen.id);
 UPDATE public.campaign_ai_sessions SET version=version+1 WHERE id=p_session_id RETURNING * INTO sess;
 RETURN jsonb_build_object('status','claimed','generationId',gen.id,'claimVersion',sess.version);
END $$;

CREATE FUNCTION public.finalize_ai_generation(p_business_id uuid,p_session_id uuid,p_generation_id uuid,
 p_claim_version integer,p_output_json jsonb,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE sess public.campaign_ai_sessions; gen public.ai_generations; seq integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 SELECT * INTO STRICT sess FROM public.campaign_ai_sessions WHERE id=p_session_id AND business_id=p_business_id FOR UPDATE;
 SELECT * INTO STRICT gen FROM public.ai_generations WHERE id=p_generation_id AND business_id=p_business_id AND session_id=p_session_id FOR UPDATE;
 IF gen.status='success' THEN
  IF gen.output_json IS DISTINCT FROM p_output_json THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('status','success','generationId',gen.id,'sessionVersion',sess.version);
 END IF;
 IF gen.status<>'running' OR sess.version<>p_claim_version OR sess.status<>'active' THEN
  RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF (p_output_json->>'businessId') IS DISTINCT FROM p_business_id::text OR
  (p_output_json->>'preorderId') IS DISTINCT FROM sess.preorder_id::text OR
  (p_output_json->>'sessionId') IS DISTINCT FROM p_session_id::text OR
  (p_output_json->>'requestKey') IS DISTINCT FROM gen.request_key OR
  (p_output_json->>'contextHash') IS DISTINCT FROM sess.context_version_hash OR
  (p_output_json->>'proposalVersion') IS DISTINCT FROM p_claim_version::text OR
  (p_output_json->>'state') IS DISTINCT FROM 'proposed' OR
  jsonb_typeof(p_output_json->'options') IS DISTINCT FROM 'array' OR
  jsonb_array_length(p_output_json->'options')>3 OR length(coalesce(p_output_json->>'reply','')) NOT BETWEEN 1 AND 4000 THEN
  RAISE EXCEPTION 'INVALID_PROPOSAL_BINDING' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(sequence),0)+1 INTO seq FROM public.campaign_ai_messages WHERE session_id=p_session_id;
 UPDATE public.ai_generations SET status='success',output_json=p_output_json,finished_at=clock_timestamp() WHERE id=gen.id;
 INSERT INTO public.campaign_ai_messages(business_id,session_id,sequence,role,body_text,proposal_json,context_hash,ai_generation_id)
 VALUES(p_business_id,p_session_id,seq,'assistant',p_output_json->>'reply',p_output_json,sess.context_version_hash,gen.id);
 UPDATE public.campaign_ai_sessions SET version=version+1 WHERE id=p_session_id RETURNING * INTO sess;
 RETURN jsonb_build_object('status','success','generationId',gen.id,'sessionVersion',sess.version);
END $$;

CREATE FUNCTION public.fail_ai_generation(p_business_id uuid,p_session_id uuid,p_generation_id uuid,
 p_claim_version integer,p_error_code text,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE sess public.campaign_ai_sessions; gen public.ai_generations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 IF p_error_code IS NULL OR p_error_code !~ '^[A-Z_]{1,64}$' THEN RAISE EXCEPTION 'SAFE_ERROR_CODE_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT * INTO STRICT sess FROM public.campaign_ai_sessions WHERE id=p_session_id AND business_id=p_business_id FOR UPDATE;
 SELECT * INTO STRICT gen FROM public.ai_generations WHERE id=p_generation_id AND session_id=p_session_id AND business_id=p_business_id FOR UPDATE;
 IF gen.status='failed' AND gen.error_code=p_error_code THEN RETURN jsonb_build_object('status','failed','sessionVersion',sess.version); END IF;
 IF gen.status<>'running' OR sess.version<>p_claim_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 UPDATE public.ai_generations SET status='failed',error_code=p_error_code,finished_at=clock_timestamp() WHERE id=gen.id;
 UPDATE public.campaign_ai_sessions SET version=version+1 WHERE id=p_session_id RETURNING * INTO sess;
 RETURN jsonb_build_object('status','failed','sessionVersion',sess.version);
END $$;

-- CAMPAIGN_OPERATIONS

CREATE FUNCTION private.lock_campaign_context(p_campaign_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE camp public.campaigns; po public.preorders; item public.preorder_items;
 cap public.production_capacity; prod public.products; used bigint; event_used bigint; paid bigint;
BEGIN
 SELECT * INTO STRICT camp FROM public.campaigns WHERE id=p_campaign_id;
 SELECT * INTO STRICT item FROM public.preorder_items WHERE preorder_id=camp.preorder_id;
 SELECT * INTO STRICT cap FROM public.production_capacity WHERE id=item.capacity_id FOR UPDATE;
 SELECT * INTO STRICT po FROM public.preorders WHERE id=camp.preorder_id FOR UPDATE;
 SELECT * INTO STRICT item FROM public.preorder_items WHERE id=item.id FOR UPDATE;
 SELECT * INTO STRICT prod FROM public.products WHERE id=item.product_id FOR UPDATE;
 SELECT * INTO STRICT camp FROM public.campaigns WHERE id=p_campaign_id FOR UPDATE;
 SELECT coalesce(sum(quantity),0) INTO used FROM public.capacity_reservations
 WHERE capacity_id=cap.id AND (state='allocated' OR (state='held' AND expires_at>clock_timestamp()));
 SELECT coalesce(sum(quantity),0) INTO event_used FROM public.capacity_reservations
 WHERE preorder_item_id=item.id AND (state='allocated' OR (state='held' AND expires_at>clock_timestamp()));
 SELECT coalesce(sum(i.quantity),0) INTO paid FROM public.orders o JOIN public.order_items i ON i.order_id=o.id
 WHERE o.preorder_id=po.id AND o.order_status='active' AND o.fulfillment_status<>'cancelled' AND
 (o.external_payment_status='confirmed' OR EXISTS(SELECT 1 FROM public.payments p WHERE p.order_id=o.id AND p.applied_at IS NOT NULL));
 RETURN jsonb_build_object('businessId',camp.business_id,'preorderId',po.id,'itemId',item.id,'capacityId',cap.id,
  'capacityVersion',cap.version,'preorderVersion',po.version,'preorderItemVersion',item.version,
  'productVersion',prod.version,'campaignVersion',camp.version,'basePriceIdr',item.base_price_snapshot_idr,
  'variableCostIdr',prod.variable_cost_idr,'costQuality',prod.cost_quality,
  'orderableUnits',greatest(least(cap.total_units-used,item.quota_units-event_used),0),
  'paidUnits',paid,'targetUnits',item.target_units,'startsAt',po.starts_at,'endsAt',po.ends_at,'preorderStatus',po.status);
END $$;
CREATE FUNCTION private.check_context_versions(p_actual jsonb,p_expected jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE k text;
BEGIN
 FOREACH k IN ARRAY ARRAY['capacityVersion','preorderVersion','preorderItemVersion','productVersion','campaignVersion'] LOOP
  IF p_actual->>k IS DISTINCT FROM p_expected->>k THEN RAISE EXCEPTION 'STALE_FACT_VERSIONS' USING ERRCODE='40001'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION public.publish_preorder(p_business_id uuid,p_preorder_id uuid,p_expected_version integer,p_actor_user_id uuid DEFAULT NULL)
RETURNS public.preorders LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item public.preorder_items; cap public.production_capacity; po public.preorders; prod public.products;
BEGIN
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 SELECT * INTO STRICT item FROM public.preorder_items WHERE preorder_id=p_preorder_id AND business_id=p_business_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text||(SELECT fulfillment_date::text FROM public.preorders WHERE id=p_preorder_id),0));
 SELECT * INTO STRICT cap FROM public.production_capacity WHERE id=item.capacity_id FOR UPDATE;
 SELECT * INTO STRICT po FROM public.preorders WHERE id=p_preorder_id AND business_id=p_business_id FOR UPDATE;
 SELECT * INTO STRICT item FROM public.preorder_items WHERE id=item.id FOR UPDATE;
 SELECT * INTO STRICT prod FROM public.products WHERE id=item.product_id FOR UPDATE;
 IF po.version<>p_expected_version OR po.status<>'draft' OR NOT prod.is_active OR po.ends_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'PREORDER_NOT_PUBLISHABLE' USING ERRCODE='40001'; END IF;
 UPDATE public.preorder_items SET base_price_snapshot_idr=prod.base_price_idr,
  product_name_snapshot=prod.name,sku_snapshot=prod.sku WHERE id=item.id;
 UPDATE public.preorders SET status='published',published_at=clock_timestamp(),pickup_terms_snapshot=
  (SELECT jsonb_build_object('pickupInstructions',pickup_instructions) FROM public.businesses WHERE id=p_business_id)
 WHERE id=po.id RETURNING * INTO po;
 RETURN po;
END $$;

CREATE FUNCTION public.save_campaign_draft(p_business_id uuid,p_campaign_id uuid,p_preorder_id uuid,
 p_expected_version integer,p_draft jsonb,p_actor_user_id uuid) RETURNS public.campaigns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.campaigns; item public.preorder_items;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 SELECT * INTO STRICT item FROM public.preorder_items WHERE preorder_id=p_preorder_id AND business_id=p_business_id;
 PERFORM 1 FROM public.production_capacity WHERE id=item.capacity_id FOR UPDATE;
 PERFORM 1 FROM public.preorders WHERE id=p_preorder_id FOR UPDATE;
 PERFORM 1 FROM public.preorder_items WHERE id=item.id FOR UPDATE;
 SELECT * INTO result FROM public.campaigns WHERE id=p_campaign_id FOR UPDATE;
 IF FOUND THEN
  IF result.business_id<>p_business_id OR result.preorder_id<>p_preorder_id OR result.status<>'draft' OR result.version<>p_expected_version THEN
   RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM public.campaign_tasks WHERE campaign_id=result.id AND completed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'EXECUTED_PLAN_REQUIRES_NEW_CAMPAIGN' USING ERRCODE='23514'; END IF;
  UPDATE public.campaign_blueprints SET approval_status='discarded' WHERE campaign_id=result.id AND approval_status='approved';
  UPDATE public.campaigns SET name=p_draft->>'name',slug=p_draft->>'slug',offer_type=p_draft->>'offerType',
   marketing_approach=p_draft->>'marketingApproach',discount_bps=(p_draft->>'discountBps')::integer,
   budget_cap_idr=(p_draft->>'budgetCapIdr')::bigint,target_additional_units=(p_draft->>'targetAdditionalUnits')::integer,
   starts_at=(p_draft->>'startsAt')::timestamptz,ends_at=(p_draft->>'endsAt')::timestamptz,active_blueprint_id=NULL
  WHERE id=result.id RETURNING * INTO result;
 ELSE
  IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  INSERT INTO public.campaigns(id,business_id,preorder_id,name,slug,status,offer_type,marketing_approach,
   discount_bps,budget_cap_idr,primary_kpi,target_additional_units,starts_at,ends_at,costs_completeness)
  VALUES(p_campaign_id,p_business_id,p_preorder_id,p_draft->>'name',p_draft->>'slug','draft',p_draft->>'offerType',
   p_draft->>'marketingApproach',(p_draft->>'discountBps')::integer,(p_draft->>'budgetCapIdr')::bigint,
   'paid_units_in_window',(p_draft->>'targetAdditionalUnits')::integer,
   (p_draft->>'startsAt')::timestamptz,(p_draft->>'endsAt')::timestamptz,'unreviewed') RETURNING * INTO result;
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.save_blueprint_revision(p_business_id uuid,p_campaign_id uuid,p_expected_campaign_version integer,
 p_blueprint_id uuid,p_context_hash text,p_blueprint_json jsonb,p_source_generation_id uuid,p_actor_user_id uuid)
RETURNS public.campaign_blueprints LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx jsonb; result public.campaign_blueprints; next_version integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 ctx:=private.lock_campaign_context(p_campaign_id);
 IF ctx->>'businessId'<>p_business_id::text OR (ctx->>'campaignVersion')::integer<>p_expected_campaign_version OR
  (SELECT status FROM public.campaigns WHERE id=p_campaign_id)<>'draft' THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF p_source_generation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ai_generations WHERE id=p_source_generation_id
  AND business_id=p_business_id AND preorder_id=(ctx->>'preorderId')::uuid AND (campaign_id IS NULL OR campaign_id=p_campaign_id) AND status='success') THEN
  RAISE EXCEPTION 'GENERATION_SOURCE_MISMATCH' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_tasks WHERE campaign_id=p_campaign_id AND completed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'EXECUTED_PLAN_REQUIRES_NEW_CAMPAIGN' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(version),0)+1 INTO next_version FROM public.campaign_blueprints WHERE campaign_id=p_campaign_id;
 UPDATE public.campaign_blueprints SET approval_status='discarded' WHERE campaign_id=p_campaign_id AND approval_status='approved';
 INSERT INTO public.campaign_blueprints(id,business_id,campaign_id,version,approval_status,blueprint_json,source_ai_generation_id,context_hash)
 VALUES(p_blueprint_id,p_business_id,p_campaign_id,next_version,'proposed',p_blueprint_json,p_source_generation_id,p_context_hash) RETURNING * INTO result;
 UPDATE public.campaigns SET active_blueprint_id=result.id WHERE id=p_campaign_id;
 RETURN result;
END $$;

CREATE FUNCTION public.approve_blueprint(p_business_id uuid,p_blueprint_id uuid,p_expected_versions jsonb,
 p_context_hash text,p_actor_user_id uuid) RETURNS public.campaign_blueprints
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE bp public.campaign_blueprints; camp public.campaigns; ctx jsonb; body jsonb; entry jsonb;
 v_offer_type text; bps integer; start_time timestamptz; end_time timestamptz; units integer; final_price numeric;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 SELECT * INTO STRICT bp FROM public.campaign_blueprints WHERE id=p_blueprint_id AND business_id=p_business_id;
 ctx:=private.lock_campaign_context(bp.campaign_id);
 SELECT * INTO STRICT camp FROM public.campaigns WHERE id=bp.campaign_id;
 SELECT * INTO STRICT bp FROM public.campaign_blueprints WHERE id=p_blueprint_id FOR UPDATE;
 IF bp.context_hash IS DISTINCT FROM p_context_hash THEN RAISE EXCEPTION 'CONTEXT_HASH_MISMATCH' USING ERRCODE='40001'; END IF;
 IF bp.approval_status='approved' AND camp.active_blueprint_id=bp.id THEN RETURN bp; END IF;
 PERFORM private.check_context_versions(ctx,p_expected_versions);
 body:=bp.blueprint_json;
 IF bp.approval_status<>'proposed' OR camp.status<>'draft' OR camp.active_blueprint_id IS DISTINCT FROM bp.id OR
  bp.context_hash<>p_context_hash OR body->>'contextHash' IS DISTINCT FROM bp.context_hash OR
  body->>'preorderId' IS DISTINCT FROM camp.preorder_id::text OR body->>'schemaVersion' IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'BLUEPRINT_NOT_APPROVABLE' USING ERRCODE='40001'; END IF;
 v_offer_type:=body#>>'{offer,type}'; bps:=(body#>>'{offer,discountBps}')::integer;
 start_time:=(body#>>'{executionWindow,startsAt}')::timestamptz; end_time:=(body#>>'{executionWindow,endsAt}')::timestamptz;
 units:=(body->>'targetAdditionalUnits')::integer;
 IF units IS NULL OR units<=0 OR units>(ctx->>'orderableUnits')::bigint OR
  start_time IS NULL OR end_time IS NULL OR start_time>=end_time OR start_time<(ctx->>'startsAt')::timestamptz OR
  end_time>(ctx->>'endsAt')::timestamptz OR end_time<=clock_timestamp() THEN
  RAISE EXCEPTION 'BLUEPRINT_CAPACITY_OR_WINDOW' USING ERRCODE='23514'; END IF;
 IF v_offer_type='percent_discount' THEN
  final_price:=(ctx->>'basePriceIdr')::numeric-floor((ctx->>'basePriceIdr')::numeric*bps/10000);
  IF bps IS NULL OR bps NOT BETWEEN 1 AND 9999 OR ctx->>'costQuality'='unknown' OR
   ctx->>'variableCostIdr' IS NULL OR final_price<=(ctx->>'variableCostIdr')::numeric THEN
   RAISE EXCEPTION 'DISCOUNT_POLICY_BLOCKER' USING ERRCODE='23514'; END IF;
 ELSIF v_offer_type IS DISTINCT FROM 'normal_price' OR bps IS DISTINCT FROM 0 THEN
  RAISE EXCEPTION 'UNSUPPORTED_OFFER' USING ERRCODE='23514';
 END IF;
 IF jsonb_typeof(body->'tasks') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'tasks') NOT BETWEEN 1 AND 12 OR
  jsonb_typeof(body->'contents') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'contents') NOT BETWEEN 1 AND 8 THEN
  RAISE EXCEPTION 'BLUEPRINT_CONTENT_BOUNDS' USING ERRCODE='23514'; END IF;
 UPDATE public.campaign_blueprints SET approval_status='approved',approved_at=clock_timestamp(),approved_by_user_id=p_actor_user_id
 WHERE id=bp.id RETURNING * INTO bp;
 UPDATE public.campaigns SET offer_type=v_offer_type,marketing_approach=body->>'marketingApproach',discount_bps=bps,
  budget_cap_idr=(body->>'budgetCapIdr')::bigint,target_additional_units=units,primary_kpi=body->>'primaryKpi',
  starts_at=start_time,ends_at=end_time WHERE id=camp.id;
 FOR entry IN SELECT value FROM jsonb_array_elements(body->'tasks') LOOP
  IF (entry->>'dueAt')::timestamptz>end_time THEN RAISE EXCEPTION 'TASK_AFTER_CAMPAIGN' USING ERRCODE='23514'; END IF;
  INSERT INTO public.campaign_tasks(business_id,campaign_id,blueprint_id,task_key,title,description,channel,due_at)
  VALUES(p_business_id,camp.id,bp.id,entry->>'key',entry->>'title',entry->>'description',entry->>'channel',(entry->>'dueAt')::timestamptz);
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(body->'contents') LOOP
  INSERT INTO public.campaign_contents(business_id,campaign_id,blueprint_id,content_key,channel,content_type,body)
  VALUES(p_business_id,camp.id,bp.id,entry->>'key',entry->>'channel',entry->>'type',entry->>'body');
 END LOOP;
 RETURN bp;
END $$;

CREATE FUNCTION public.publish_campaign(p_business_id uuid,p_campaign_id uuid,p_expected_versions jsonb,p_actor_user_id uuid)
RETURNS public.campaigns LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx jsonb; camp public.campaigns; prod public.products; item public.preorder_items; final_price numeric;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 ctx:=private.lock_campaign_context(p_campaign_id);
 PERFORM private.check_context_versions(ctx,p_expected_versions);
 SELECT * INTO STRICT camp FROM public.campaigns WHERE id=p_campaign_id AND business_id=p_business_id;
 IF camp.status<>'draft' OR ctx->>'preorderStatus'<>'published' OR camp.starts_at>clock_timestamp() OR
  camp.ends_at<=clock_timestamp() OR camp.target_additional_units>(ctx->>'orderableUnits')::bigint OR
  NOT EXISTS(SELECT 1 FROM public.campaign_blueprints WHERE id=camp.active_blueprint_id AND approval_status='approved') THEN
  RAISE EXCEPTION 'CAMPAIGN_NOT_PUBLISHABLE' USING ERRCODE='23514'; END IF;
 IF camp.offer_type='percent_discount' THEN
  final_price:=(ctx->>'basePriceIdr')::numeric-floor((ctx->>'basePriceIdr')::numeric*camp.discount_bps/10000);
  IF ctx->>'variableCostIdr' IS NULL OR ctx->>'costQuality'='unknown' OR final_price<=(ctx->>'variableCostIdr')::numeric THEN
   RAISE EXCEPTION 'DISCOUNT_POLICY_BLOCKER' USING ERRCODE='23514'; END IF;
 END IF;
 UPDATE public.campaigns SET status='published',published_at=clock_timestamp(),published_blueprint_id=active_blueprint_id,
  baseline_json=jsonb_build_object('baseline_preorder_paid_units',(ctx->>'paidUnits')::bigint,'sourceVersions',ctx),
  baseline_calculated_at=clock_timestamp(),metrics_schema_version=1 WHERE id=camp.id RETURNING * INTO camp;
 RETURN camp;
END $$;

CREATE FUNCTION public.close_campaign(p_business_id uuid,p_campaign_id uuid,p_expected_version integer,p_actor_user_id uuid DEFAULT NULL)
RETURNS public.campaigns LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE camp public.campaigns;
BEGIN
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 PERFORM private.lock_campaign_context(p_campaign_id);
 SELECT * INTO STRICT camp FROM public.campaigns WHERE id=p_campaign_id AND business_id=p_business_id;
 IF camp.status<>'published' OR camp.version<>p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 UPDATE public.campaigns SET status='closed',closed_at=clock_timestamp() WHERE id=camp.id RETURNING * INTO camp;
 RETURN camp;
END $$;

-- MEMORY_AND_WORKERS

CREATE FUNCTION public.record_campaign_evaluation(p_business_id uuid,p_campaign_id uuid,p_blueprint_id uuid,
 p_evaluation_id uuid,p_kind text,p_metrics jsonb,p_analysis jsonb,p_limitations jsonb,
 p_calculated_at timestamptz,p_actor_user_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE camp public.campaigns; existing public.campaign_evaluations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 PERFORM private.lock_campaign_context(p_campaign_id);
 SELECT * INTO STRICT camp FROM public.campaigns WHERE id=p_campaign_id AND business_id=p_business_id;
 SELECT * INTO existing FROM public.campaign_evaluations WHERE id=p_evaluation_id;
 IF FOUND THEN
  IF (existing.business_id,existing.campaign_id,existing.blueprint_id,existing.metrics_json,existing.analysis_json,
   existing.limitations_json,existing.evaluation_kind,existing.calculated_at) IS DISTINCT FROM
   (p_business_id,p_campaign_id,p_blueprint_id,p_metrics,p_analysis,p_limitations,p_kind,p_calculated_at) THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001'; END IF;
  RETURN existing.id;
 END IF;
 IF p_kind='final' AND (camp.status NOT IN ('closed','completed') OR camp.costs_completeness<>'confirmed_complete' OR
  camp.published_blueprint_id IS DISTINCT FROM p_blueprint_id OR EXISTS(
   SELECT 1 FROM public.orders o WHERE (o.attribution_campaign_id=camp.id OR o.pricing_campaign_id=camp.id) AND
   (o.order_status IN ('pending_payment','awaiting_confirmation','requires_review') OR
    (o.order_status='active' AND o.fulfillment_status NOT IN ('fulfilled','cancelled')))) OR EXISTS(
   SELECT 1 FROM public.order_production_costs l JOIN public.order_items i ON i.id=l.order_item_id
   JOIN public.orders o ON o.id=i.order_id WHERE (o.attribution_campaign_id=camp.id OR o.pricing_campaign_id=camp.id) AND l.amount_idr IS NULL) OR EXISTS(
   SELECT 1 FROM public.order_items i JOIN public.orders o ON o.id=i.order_id
   WHERE (o.attribution_campaign_id=camp.id OR o.pricing_campaign_id=camp.id)
    AND (o.production_started_at IS NOT NULL OR o.fulfillment_status IN ('in_production','ready','fulfilled'))
    AND NOT EXISTS(SELECT 1 FROM public.order_production_costs l WHERE l.order_item_id=i.id
     AND l.cost_kind='variable_production' AND l.quantity=i.quantity AND l.amount_idr IS NOT NULL))) THEN
  RAISE EXCEPTION 'FINAL_EVALUATION_INCOMPLETE' USING ERRCODE='23514'; END IF;
 INSERT INTO public.campaign_evaluations(id,business_id,campaign_id,blueprint_id,metrics_schema_version,
  metrics_json,analysis_json,limitations_json,evaluation_kind,calculated_at,evaluated_at)
 VALUES(p_evaluation_id,p_business_id,p_campaign_id,p_blueprint_id,1,p_metrics,p_analysis,p_limitations,p_kind,p_calculated_at,clock_timestamp());
 RETURN p_evaluation_id;
END $$;

CREATE FUNCTION public.approve_campaign_memory(p_business_id uuid,p_memory_id uuid,p_content_hash text,
 p_model text,p_profile text,p_actor_user_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE memory public.campaign_memories; jid uuid; key text;
BEGIN
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 SELECT * INTO STRICT memory FROM public.campaign_memories WHERE id=p_memory_id AND business_id=p_business_id FOR UPDATE;
 IF memory.content_hash<>p_content_hash OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 128 OR
  p_profile IS NULL OR length(p_profile) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'MEMORY_SOURCE_CONFLICT' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campaign_evaluations WHERE id=memory.source_evaluation_id AND evaluation_kind='final') THEN
  RAISE EXCEPTION 'FINAL_EVALUATION_REQUIRED' USING ERRCODE='23514'; END IF;
 IF memory.review_status='approved' AND (memory.embedding_model IS DISTINCT FROM p_model OR memory.embedding_profile IS DISTINCT FROM p_profile) THEN
  RAISE EXCEPTION 'PROFILE_CHANGE_REQUIRES_REVIEWED_VERSION' USING ERRCODE='40001'; END IF;
 UPDATE public.campaign_memories SET review_status='approved',approved_at=coalesce(approved_at,clock_timestamp()),
  embedding_model=p_model,embedding_profile=p_profile WHERE id=memory.id;
 key:=jsonb_build_array(memory.id,memory.embedding_version,memory.content_hash,p_model,p_profile)::text;
 INSERT INTO public.job_runs(job_type,entity_id,business_id,dedupe_key,status,attempt_count,next_run_at)
 VALUES('embed_memory',memory.id,p_business_id,key,'queued',0,clock_timestamp()) ON CONFLICT(job_type,dedupe_key) DO NOTHING;
 SELECT id INTO STRICT jid FROM public.job_runs WHERE job_type='embed_memory' AND dedupe_key=key;
 RETURN jid;
END $$;

CREATE FUNCTION public.complete_memory_indexing(p_memory_id uuid,p_content_hash text,p_embedding_version integer,
 p_model text,p_profile text,p_embedding extensions.vector(768)) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 IF p_embedding IS NULL OR extensions.vector_dims(p_embedding)<>768 OR extensions.vector_norm(p_embedding)=0 THEN
  RAISE EXCEPTION 'INVALID_EMBEDDING' USING ERRCODE='22023'; END IF;
 UPDATE public.campaign_memories SET embedding=p_embedding,embedding_status='ready',indexed_at=clock_timestamp()
 WHERE id=p_memory_id AND content_hash=p_content_hash AND embedding_version=p_embedding_version AND review_status='approved'
  AND embedding_model=p_model AND embedding_profile=p_profile AND embedding_status IN ('queued','failed');
 IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM public.campaign_memories WHERE id=p_memory_id AND content_hash=p_content_hash
  AND embedding_version=p_embedding_version AND review_status='approved' AND embedding_status='ready'
  AND embedding_model=p_model AND embedding_profile=p_profile) THEN
  RAISE EXCEPTION 'STALE_EMBEDDING_JOB' USING ERRCODE='40001'; END IF;
END $$;

CREATE FUNCTION public.match_campaign_memories(p_business_id uuid,p_embedding extensions.vector(768),p_model text,
 p_profile text,p_embedding_version integer,p_limit integer DEFAULT 5,p_min_similarity double precision DEFAULT 0.5)
RETURNS TABLE(memory_id uuid,campaign_id uuid,source_evaluation_id uuid,summary_text text,lessons_json jsonb,
 limitations_json jsonb,similarity double precision) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_business_owner(p_business_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_embedding IS NULL OR extensions.vector_dims(p_embedding)<>768 OR extensions.vector_norm(p_embedding)=0 OR
  p_limit NOT BETWEEN 1 AND 20 OR p_min_similarity NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'INVALID_RETRIEVAL_INPUT' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH eligible AS MATERIALIZED (
  SELECT m.* FROM public.campaign_memories m WHERE m.business_id=p_business_id AND m.review_status='approved'
   AND m.embedding_status='ready' AND m.embedding_model=p_model AND m.embedding_profile=p_profile AND m.embedding_version=p_embedding_version
 ) SELECT m.id,m.campaign_id,m.source_evaluation_id,m.summary_text,m.lessons_json,m.limitations_json,
  1-(m.embedding OPERATOR(extensions.<=>) p_embedding) FROM eligible m
 WHERE 1-(m.embedding OPERATOR(extensions.<=>) p_embedding)>=p_min_similarity
 ORDER BY m.embedding OPERATOR(extensions.<=>) p_embedding,m.id LIMIT p_limit;
END $$;

CREATE FUNCTION public.claim_jobs(p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 60,p_max_attempts integer DEFAULT 5)
RETURNS SETOF public.job_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 IF p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 1 AND 300 OR p_max_attempts NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION 'INVALID_JOB_CLAIM' USING ERRCODE='22023'; END IF;
 UPDATE public.job_runs SET status='dead',finished_at=clock_timestamp(),last_error_code=coalesce(last_error_code,'MAX_ATTEMPTS')
 WHERE attempt_count>=p_max_attempts AND (status IN ('queued','retryable_failed') OR (status='running' AND locked_until<clock_timestamp()));
 RETURN QUERY WITH picked AS (
  SELECT id FROM public.job_runs WHERE attempt_count<p_max_attempts AND next_run_at<=clock_timestamp() AND
   (status IN ('queued','retryable_failed') OR (status='running' AND locked_until<clock_timestamp()))
  ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit
 ) UPDATE public.job_runs j SET status='running',attempt_count=j.attempt_count+1,
  locked_until=clock_timestamp()+make_interval(secs=>p_lease_seconds) FROM picked WHERE j.id=picked.id RETURNING j.*;
END $$;
CREATE FUNCTION public.finish_job(p_job_id uuid,p_attempt_count integer,p_success boolean,p_error_code text DEFAULT NULL,p_provider_reference text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 IF p_error_code IS NOT NULL AND p_error_code !~ '^[A-Z_]{1,64}$' THEN RAISE EXCEPTION 'SAFE_ERROR_CODE_REQUIRED' USING ERRCODE='22023'; END IF;
 IF p_success AND EXISTS(SELECT 1 FROM public.job_runs WHERE id=p_job_id AND status='succeeded' AND attempt_count=p_attempt_count
  AND provider_reference IS NOT DISTINCT FROM p_provider_reference) THEN RETURN; END IF;
 UPDATE public.job_runs SET status=CASE WHEN p_success THEN 'succeeded' ELSE 'retryable_failed' END,
  finished_at=CASE WHEN p_success THEN clock_timestamp() ELSE NULL END,locked_until=NULL,last_error_code=p_error_code,
  provider_reference=p_provider_reference,next_run_at=clock_timestamp()+interval '30 seconds'
 WHERE id=p_job_id AND status='running' AND attempt_count=p_attempt_count AND locked_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'STALE_JOB_LEASE' USING ERRCODE='40001'; END IF;
END $$;
CREATE FUNCTION public.take_rate_limit(p_key_hash text,p_window_start timestamptz,p_expires_at timestamptz,p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE used integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 IF p_limit<1 OR p_expires_at<=p_window_start THEN RAISE EXCEPTION 'INVALID_BUCKET' USING ERRCODE='22023'; END IF;
 INSERT INTO public.rate_limit_buckets(bucket_key_hash,window_start,count,expires_at) VALUES(p_key_hash,p_window_start,1,p_expires_at)
 ON CONFLICT(bucket_key_hash,window_start) DO UPDATE SET count=public.rate_limit_buckets.count+1 RETURNING count INTO used;
 RETURN used<=p_limit;
END $$;

CREATE FUNCTION private.guard_memory() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF OLD.review_status='approved' AND (NEW.summary_text,NEW.lessons_json,NEW.limitations_json,NEW.content_hash,
  NEW.source_evaluation_id,NEW.source_blueprint_id,NEW.source_version,NEW.business_id,NEW.campaign_id)
  IS DISTINCT FROM (OLD.summary_text,OLD.lessons_json,OLD.limitations_json,OLD.content_hash,
  OLD.source_evaluation_id,OLD.source_blueprint_id,OLD.source_version,OLD.business_id,OLD.campaign_id) THEN
  RAISE EXCEPTION 'APPROVED_MEMORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER memory_guard BEFORE UPDATE ON public.campaign_memories FOR EACH ROW EXECUTE FUNCTION private.guard_memory();

CREATE FUNCTION private.guard_blueprint() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF OLD.approved_at IS NOT NULL AND (NEW.blueprint_json,NEW.context_hash,NEW.business_id,NEW.campaign_id,NEW.version,
  NEW.source_ai_generation_id,NEW.approved_at,NEW.approved_by_user_id) IS DISTINCT FROM
  (OLD.blueprint_json,OLD.context_hash,OLD.business_id,OLD.campaign_id,OLD.version,
  OLD.source_ai_generation_id,OLD.approved_at,OLD.approved_by_user_id) THEN
  RAISE EXCEPTION 'APPROVED_BLUEPRINT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.approval_status<>'approved' AND EXISTS(SELECT 1 FROM public.campaigns WHERE published_blueprint_id=OLD.id) THEN
  RAISE EXCEPTION 'PUBLISHED_BLUEPRINT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER blueprint_guard BEFORE UPDATE ON public.campaign_blueprints FOR EACH ROW EXECUTE FUNCTION private.guard_blueprint();

-- Payment application and scoped locking.

CREATE FUNCTION private.lock_order_context(p_order_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE row_id uuid; pid uuid;
BEGIN
 FOR row_id IN SELECT DISTINCT capacity_id FROM public.capacity_reservations WHERE order_id=p_order_id ORDER BY capacity_id LOOP
  PERFORM 1 FROM public.production_capacity WHERE id=row_id FOR UPDATE;
 END LOOP;
 SELECT preorder_id INTO pid FROM public.orders WHERE id=p_order_id;
 IF pid IS NOT NULL THEN
  PERFORM 1 FROM public.preorders WHERE id=pid FOR UPDATE;
  PERFORM 1 FROM public.preorder_items WHERE preorder_id=pid FOR UPDATE;
 END IF;
 PERFORM 1 FROM public.orders WHERE id=p_order_id FOR UPDATE;
END $$;
CREATE FUNCTION public.apply_verified_payment(p_payment_id uuid,p_provider_order_id text,p_event_key text,
 p_payload_hash text,p_amount_idr bigint,p_provider_status text,p_provider_paid_at timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pay public.payments; ord public.orders; event public.payment_events; v_outcome text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT pay FROM public.payments WHERE id=p_payment_id;
 PERFORM private.lock_order_context(pay.order_id);
 SELECT * INTO STRICT ord FROM public.orders WHERE id=pay.order_id;
 SELECT * INTO STRICT pay FROM public.payments WHERE id=p_payment_id FOR UPDATE;
 IF p_provider_order_id IS DISTINCT FROM pay.provider_order_id OR p_amount_idr IS DISTINCT FROM pay.amount_idr OR
  pay.amount_idr<>ord.total_idr OR p_provider_status IS NULL OR p_provider_status NOT IN ('capture','settlement') OR p_provider_paid_at IS NULL THEN
  RAISE EXCEPTION 'VERIFIED_PAYMENT_MISMATCH' USING ERRCODE='23514'; END IF;
 INSERT INTO public.payment_events(business_id,payment_id,provider_event_key,payload_hash,provider_status,signature_valid,verified_at,outcome)
 VALUES(pay.business_id,pay.id,p_event_key,p_payload_hash,p_provider_status,true,clock_timestamp(),'received')
 ON CONFLICT(payment_id,provider_event_key) DO NOTHING;
 SELECT * INTO STRICT event FROM public.payment_events WHERE payment_id=pay.id AND provider_event_key=p_event_key FOR UPDATE;
 IF event.payload_hash<>p_payload_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001'; END IF;
 IF event.processed_at IS NOT NULL THEN RETURN event.outcome; END IF;
 IF pay.applied_at IS NOT NULL THEN v_outcome:='already_applied';
 ELSIF EXISTS(SELECT 1 FROM public.payments WHERE order_id=ord.id AND applied_at IS NOT NULL) OR
  ord.order_status NOT IN ('pending_payment','awaiting_confirmation') OR
  NOT EXISTS(SELECT 1 FROM public.capacity_reservations WHERE order_id=ord.id) OR
  EXISTS(SELECT 1 FROM public.order_items i WHERE i.order_id=ord.id AND NOT EXISTS
   (SELECT 1 FROM public.capacity_reservations r WHERE r.order_item_id=i.id AND r.order_id=ord.id)) OR
  EXISTS(SELECT 1 FROM public.capacity_reservations WHERE order_id=ord.id AND (state<>'held' OR expires_at<=clock_timestamp())) THEN
  UPDATE public.payments SET status='paid_sandbox',is_active_attempt=false,verified_at=clock_timestamp(),
   provider_paid_at=p_provider_paid_at,review_reason='late_or_duplicate_payment' WHERE id=pay.id;
  v_outcome:='requires_review';
 ELSE
  UPDATE public.capacity_reservations SET state='allocated' WHERE order_id=ord.id AND state='held';
  UPDATE public.payments SET status='paid_sandbox',is_active_attempt=false,verified_at=clock_timestamp(),
   provider_paid_at=p_provider_paid_at,applied_at=clock_timestamp() WHERE id=pay.id;
  UPDATE public.orders SET order_status='active',fulfillment_status='confirmed',confirmed_at=clock_timestamp() WHERE id=ord.id;
  INSERT INTO public.job_runs(job_type,entity_id,business_id,dedupe_key,status,attempt_count,next_run_at)
  VALUES('send_paid_email',ord.id,ord.business_id,ord.id::text||':1','queued',0,clock_timestamp()) ON CONFLICT(job_type,dedupe_key) DO NOTHING;
  INSERT INTO public.order_events(business_id,order_id,command_key,event_type,to_state,actor_type)
  VALUES(ord.business_id,ord.id,'apply:'||pay.id::text,'payment_applied','active','provider') ON CONFLICT DO NOTHING;
  v_outcome:='applied';
 END IF;
 UPDATE public.payment_events SET processed_at=clock_timestamp(),outcome=v_outcome WHERE id=event.id;
 RETURN v_outcome;
END $$;

CREATE FUNCTION private.guard_payment() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF OLD.applied_at IS NOT NULL AND (NEW.applied_at,NEW.order_id,NEW.business_id,NEW.amount_idr,NEW.status,NEW.provider_order_id)
  IS DISTINCT FROM (OLD.applied_at,OLD.order_id,OLD.business_id,OLD.amount_idr,OLD.status,OLD.provider_order_id) THEN
  RAISE EXCEPTION 'APPLIED_PAYMENT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_guard BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.guard_payment();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['campaign_ai_messages','campaign_evaluations','order_events','domain_events'] LOOP
  EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.append_only()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['capacity_reservations','payments','payment_events','order_production_costs'] LOOP
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.append_only()',t);
 END LOOP;
END $$;

DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',t.tablename);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO service_role',t.tablename);
  IF t.tablename='businesses' THEN
   CREATE POLICY owner_read ON public.businesses FOR SELECT TO authenticated USING(public.is_business_owner(id));
  ELSIF t.tablename='business_members' THEN
   CREATE POLICY owner_read ON public.business_members FOR SELECT TO authenticated USING(user_id=auth.uid());
  ELSIF t.tablename<>'rate_limit_buckets' THEN
   EXECUTE format('CREATE POLICY owner_read ON public.%I FOR SELECT TO authenticated USING(public.is_business_owner(business_id))',t.tablename);
  END IF;
  IF t.tablename<>'rate_limit_buckets' THEN EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t.tablename); END IF;
 END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_business_owner(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(text,text,text,text,uuid),
 public.create_ai_session(uuid,uuid,uuid,text,uuid),public.refresh_ai_session_context(uuid,uuid,integer,text,uuid),
 public.claim_ai_generation(uuid,uuid,integer,text,text,text,text,text,text,uuid),
 public.publish_preorder(uuid,uuid,integer,uuid),public.close_campaign(uuid,uuid,integer,uuid),
 public.approve_campaign_memory(uuid,uuid,text,text,text,uuid),
 public.match_campaign_memories(uuid,extensions.vector,text,text,integer,integer,double precision) TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

COMMIT;
