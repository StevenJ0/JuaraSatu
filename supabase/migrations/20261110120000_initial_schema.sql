-- =============================================================================
-- juarasatu — schema database lengkap (satu migration)
--
-- Menyatukan seluruh migration sebelumnya menjadi satu setup untuk project Supabase baru (misalnya Supabase cloud).
-- Isinya kondisi akhir schema yang berjalan di aplikasi:
--   1. Extension vector (schema extensions) dan schema private.
--   2. Seluruh tabel, constraint, index, trigger, fungsi/RPC, dan RLS policy di schema public dan private.
--   3. Hak akses role API (anon, authenticated, service_role) persis per tabel, kolom, dan fungsi.
--   4. Bucket Storage product-photos beserta policy-nya.
--
-- Hanya untuk database baru yang masih kosong. Jangan dijalankan ulang di database yang sudah punya schema ini.
-- Data contoh untuk pengembangan lokal ada di supabase/seed.sql dan tidak ikut di sini.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

--
-- PostgreSQL database dump
--

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS private;

--
-- Name: append_only(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY' USING ERRCODE='23514'; END $$;

--
-- Name: approve_memory_and_enqueue(uuid, uuid, text, text, text, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.approve_memory_and_enqueue(p_business_id uuid, p_memory_id uuid, p_content_hash text, p_model text, p_profile text, p_actor_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
DECLARE m public.campaign_memories; j public.job_runs; k text;
BEGIN
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 SELECT * INTO STRICT m FROM public.campaign_memories WHERE id=p_memory_id AND business_id=p_business_id FOR UPDATE;
 IF m.content_hash IS DISTINCT FROM p_content_hash OR p_content_hash !~ '^[a-f0-9]{64}$' OR
    p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 128 OR p_profile IS NULL OR length(p_profile) NOT BETWEEN 1 AND 128 THEN
  RAISE EXCEPTION 'MEMORY_SOURCE_CONFLICT' USING ERRCODE='40001';
 END IF;
 IF m.lessons_json#>>'{ownerReview,decision}' IS DISTINCT FROM 'reviewed' OR
    m.lessons_json#>>'{ownerReview,ownerUserId}' IS DISTINCT FROM p_actor_user_id::text OR
    m.lessons_json#>>'{ownerReview,requestId}' IS NULL OR m.lessons_json#>>'{ownerReview,reviewedAt}' IS NULL THEN
  RAISE EXCEPTION 'MEMORY_OWNER_REVIEW_REQUIRED' USING ERRCODE='23514';
 END IF;
 k:=jsonb_build_array(m.id,m.embedding_version,m.content_hash,p_model,p_profile)::text;
 IF m.review_status='approved' THEN
  IF m.embedding_model IS DISTINCT FROM p_model OR m.embedding_profile IS DISTINCT FROM p_profile THEN
   RAISE EXCEPTION 'PROFILE_CHANGE_REQUIRES_REVIEWED_VERSION' USING ERRCODE='40001';
  END IF;
  SELECT * INTO STRICT j FROM public.job_runs WHERE job_type='embed_memory' AND dedupe_key=k;
  IF (j.entity_id,j.business_id) IS DISTINCT FROM (m.id,m.business_id) THEN
   RAISE EXCEPTION 'MEMORY_JOB_BINDING_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN j.id;
 END IF;
 IF m.review_status<>'draft' OR m.embedding_status<>'queued' OR m.embedding IS NOT NULL THEN
  RAISE EXCEPTION 'MEMORY_SOURCE_CONFLICT' USING ERRCODE='40001';
 END IF;
 UPDATE public.campaign_memories SET review_status='approved',approved_at=clock_timestamp(),
  embedding_model=p_model,embedding_profile=p_profile WHERE id=m.id;
 INSERT INTO public.job_runs(job_type,entity_id,business_id,dedupe_key,status,attempt_count,next_run_at)
 VALUES('embed_memory',m.id,m.business_id,k,'queued',0,clock_timestamp()) ON CONFLICT(job_type,dedupe_key) DO NOTHING;
 SELECT * INTO STRICT j FROM public.job_runs WHERE job_type='embed_memory' AND dedupe_key=k;
 IF (j.entity_id,j.business_id) IS DISTINCT FROM (m.id,m.business_id) THEN
  RAISE EXCEPTION 'MEMORY_JOB_BINDING_MISMATCH' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.domain_events(business_id,entity_type,entity_id,command_key,event_type,actor_type,actor_user_id,safe_details_json,occurred_at)
 VALUES(m.business_id,'campaign_memory',m.id,k,'memory_approved','owner',p_actor_user_id,
  jsonb_build_object('contentHash',m.content_hash,'sourceEvaluationId',m.source_evaluation_id,'sourceVersion',m.source_version,'jobId',j.id),clock_timestamp());
 RETURN j.id;
END $_$;

--
-- Name: are_valid_business_categories(text[]); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.are_valid_business_categories(p_categories text[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select array_ndims(p_categories) = 1
    and cardinality(p_categories) between 1 and 3
    and not exists (
      select 1 from unnest(p_categories) as category
      where category is null or char_length(btrim(category)) not between 1 and 80
    )
    and (
      select count(distinct lower(btrim(category))) from unnest(p_categories) as category
    ) = cardinality(p_categories);
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: preorder_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.preorder_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    preorder_id uuid NOT NULL,
    product_id uuid NOT NULL,
    capacity_id uuid NOT NULL,
    target_units integer NOT NULL,
    quota_units integer NOT NULL,
    base_price_snapshot_idr bigint NOT NULL,
    product_name_snapshot character varying(160) NOT NULL,
    sku_snapshot character varying(80) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT preorder_items_base_price_snapshot_idr_check CHECK ((base_price_snapshot_idr > 0)),
    CONSTRAINT preorder_items_check CHECK ((quota_units >= target_units)),
    CONSTRAINT preorder_items_quota_units_check CHECK ((quota_units > 0)),
    CONSTRAINT preorder_items_target_units_check CHECK ((target_units > 0)),
    CONSTRAINT preorder_items_version_check CHECK ((version > 0))
);

--
-- Name: production_capacity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_capacity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    product_id uuid NOT NULL,
    fulfillment_date date NOT NULL,
    total_units integer NOT NULL,
    intake_cutoff_at timestamp with time zone NOT NULL,
    fulfillment_window_end_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_capacity_check CHECK ((intake_cutoff_at < fulfillment_window_end_at)),
    CONSTRAINT production_capacity_total_units_check CHECK ((total_units >= 0)),
    CONSTRAINT production_capacity_version_check CHECK ((version > 0))
);

--
-- Name: assert_orderable(public.production_capacity, public.preorder_items, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.assert_orderable(p_capacity public.production_capacity, p_item public.preorder_items, p_quantity integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if p_quantity > p_capacity.total_units - private.committed_units(p_capacity.id, null)
     or p_quantity > p_item.quota_units - private.committed_units(p_capacity.id, p_item.id) then
    raise exception 'CAPACITY_UNAVAILABLE';
  end if;
end;
$$;

--
-- Name: check_context_versions(jsonb, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.check_context_versions(p_actual jsonb, p_expected jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE k text;
BEGIN
 FOREACH k IN ARRAY ARRAY['capacityVersion','preorderVersion','preorderItemVersion','productVersion','campaignVersion'] LOOP
  IF p_actual->>k IS DISTINCT FROM p_expected->>k THEN RAISE EXCEPTION 'STALE_FACT_VERSIONS' USING ERRCODE='40001'; END IF;
 END LOOP;
END $$;

--
-- Name: check_evaluation_sources(uuid, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.check_evaluation_sources(p_campaign_id uuid, p_context jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
DECLARE c public.campaigns; s jsonb:=p_context->'snapshot'; actual jsonb; expected jsonb; source_name text;
BEGIN
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=p_campaign_id;
 IF (s#>>'{campaign,id}')::uuid IS DISTINCT FROM c.id OR
    (s#>>'{campaign,business_id}')::uuid IS DISTINCT FROM c.business_id OR
    (s#>>'{campaign,preorder_id}')::uuid IS DISTINCT FROM c.preorder_id OR
    (s#>>'{campaign,version}')::integer IS DISTINCT FROM c.version OR
    s#>>'{campaign,status}' IS DISTINCT FROM c.status OR
    p_context->>'costsCompleteness' IS DISTINCT FROM c.costs_completeness OR
    NOT EXISTS(SELECT 1 FROM public.preorders p WHERE p.id=c.preorder_id AND
      p.id=(s#>>'{preorder,id}')::uuid AND p.version=(s#>>'{preorder,version}')::integer) OR
    NOT EXISTS(SELECT 1 FROM public.preorder_items i WHERE i.preorder_id=c.preorder_id AND
      i.id=(s#>>'{item,id}')::uuid AND i.version=(s#>>'{item,version}')::integer) OR
    NOT EXISTS(SELECT 1 FROM public.campaign_blueprints b WHERE b.id=c.published_blueprint_id AND
      b.id=(s#>>'{blueprint,id}')::uuid AND b.version=(s#>>'{blueprint,version}')::integer AND
      b.business_id=c.business_id AND b.campaign_id=c.id AND b.approval_status='approved') THEN
  RAISE EXCEPTION 'STALE_SOURCE_STATE' USING ERRCODE='40001';
 END IF;
 FOREACH source_name IN ARRAY ARRAY['campaign_tasks','campaign_contents','campaign_costs'] LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''id'',id,''version'',version) ORDER BY id),''[]''::jsonb) FROM public.%I WHERE campaign_id=$1',source_name)
   INTO actual USING c.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',(e->>'id')::uuid,'version',(e->>'version')::integer) ORDER BY (e->>'id')::uuid),'[]'::jsonb)
   INTO expected FROM jsonb_array_elements(CASE source_name WHEN 'campaign_tasks' THEN s->'tasks'
    WHEN 'campaign_contents' THEN s->'contents' ELSE p_context->'costs' END) e;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'STALE_SOURCE_STATE' USING ERRCODE='40001'; END IF;
 END LOOP;
END $_$;

--
-- Name: check_memory_source(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.check_memory_source(p_memory_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE m public.campaign_memories; c public.campaigns; e public.campaign_evaluations; ctx jsonb;
BEGIN
 SELECT * INTO STRICT m FROM public.campaign_memories WHERE id=p_memory_id;
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=m.campaign_id AND business_id=m.business_id;
 SELECT * INTO STRICT e FROM public.campaign_evaluations WHERE id=m.source_evaluation_id AND business_id=m.business_id AND campaign_id=c.id;
 IF e.metrics_json#>>'{finalization,mode}'='development_synthetic' OR
    m.lessons_json#>>'{source,synthetic}'='true' THEN
  RAISE EXCEPTION 'SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN' USING ERRCODE='23514';
 END IF;
 IF c.status<>'completed' OR e.evaluation_kind<>'final' OR
    e.id IS DISTINCT FROM (SELECT id FROM public.campaign_evaluations WHERE campaign_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) OR
    e.analysis_json#>>'{review,status}' IS DISTINCT FROM 'reviewed' OR
    e.analysis_json->>'status' IS DISTINCT FROM 'available' THEN
  RAISE EXCEPTION 'ELIGIBLE_COMPLETED_EVALUATION_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF m.source_blueprint_id IS DISTINCT FROM c.published_blueprint_id OR e.blueprint_id IS DISTINCT FROM c.published_blueprint_id OR
    m.source_version IS DISTINCT FROM c.version OR
    (e.metrics_json#>>'{finalization,completedCampaignVersion}')::integer IS DISTINCT FROM c.version OR
    (e.metrics_json#>>'{finalization,completedAt}')::timestamptz IS DISTINCT FROM c.completed_at OR
    m.lessons_json#>>'{source,contextHash}' IS DISTINCT FROM e.metrics_json#>>'{finalization,sourceContextHash}' OR
    m.lessons_json#>>'{source,contextHash}' IS DISTINCT FROM e.metrics_json#>>'{context,contextHash}' OR
    m.lessons_json#>>'{source,evaluationId}' IS DISTINCT FROM e.id::text OR
    m.lessons_json#>>'{source,campaignId}' IS DISTINCT FROM c.id::text OR
    m.lessons_json#>>'{source,businessId}' IS DISTINCT FROM c.business_id::text OR
    (m.lessons_json#>>'{source,sourceVersion}')::integer IS DISTINCT FROM m.source_version OR
    m.lessons_json#>'{source,results}' IS DISTINCT FROM e.metrics_json->'summary' THEN
  RAISE EXCEPTION 'STALE_MEMORY_SOURCE' USING ERRCODE='40001';
 END IF;
 ctx:=jsonb_set(jsonb_set(e.metrics_json->'context','{snapshot,campaign,version}',to_jsonb(c.version)),
  '{snapshot,campaign,status}',to_jsonb(c.status));
 PERFORM private.check_evaluation_sources(c.id,ctx);
 -- shortcut: no authoritative verified C6/finalization producer exists; replace only with its separately approved contract.
 RAISE EXCEPTION 'VERIFIED_C6_UNAVAILABLE' USING ERRCODE='23514';
END $$;

--
-- Name: check_order_totals(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.check_order_totals() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
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
    external_payment_confirmed_at timestamp with time zone,
    order_status text NOT NULL,
    fulfillment_status text NOT NULL,
    subtotal_idr bigint NOT NULL,
    discount_total_idr bigint NOT NULL,
    total_idr bigint NOT NULL,
    payment_due_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    production_started_at timestamp with time zone,
    ready_at timestamp with time zone,
    fulfilled_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    review_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orders_check CHECK (((source <> 'public'::text) OR ((preorder_id IS NOT NULL) AND (private_token_hash IS NOT NULL) AND (idempotency_key IS NOT NULL) AND (request_hash IS NOT NULL) AND (customer_email IS NOT NULL)))),
    CONSTRAINT orders_check1 CHECK ((((attribution_campaign_id IS NULL) AND (pricing_campaign_id IS NULL)) OR (preorder_id IS NOT NULL))),
    CONSTRAINT orders_check2 CHECK (((total_idr = (subtotal_idr - discount_total_idr)) AND (total_idr > 0))),
    CONSTRAINT orders_customer_email_check CHECK (((customer_email IS NULL) OR ((length(customer_email) <= 254) AND (customer_email = lower(btrim(customer_email))) AND (customer_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'::text)))),
    CONSTRAINT orders_discount_total_idr_check CHECK ((discount_total_idr >= 0)),
    CONSTRAINT orders_fulfillment_status_check CHECK ((fulfillment_status = ANY (ARRAY['pending_confirmation'::text, 'confirmed'::text, 'in_production'::text, 'ready'::text, 'fulfilled'::text, 'cancelled'::text]))),
    CONSTRAINT orders_order_status_check CHECK ((order_status = ANY (ARRAY['pending_payment'::text, 'awaiting_confirmation'::text, 'active'::text, 'expired'::text, 'cancelled'::text, 'requires_review'::text]))),
    CONSTRAINT orders_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['midtrans_sandbox'::text, 'external_manual'::text]))),
    CONSTRAINT orders_private_token_hash_check CHECK ((private_token_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT orders_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT orders_source_check CHECK ((source = ANY (ARRAY['public'::text, 'manual'::text]))),
    CONSTRAINT orders_subtotal_idr_check CHECK ((subtotal_idr >= 0)),
    CONSTRAINT orders_total_idr_check CHECK ((total_idr >= 0)),
    CONSTRAINT orders_version_check CHECK ((version > 0))
);

--
-- Name: close_active_payment_attempts(public.orders, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.close_active_payment_attempts(p_order public.orders, p_status text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with closed as (
    update public.payments
    set status = p_status, is_active_attempt = false
    where order_id = p_order.id and is_active_attempt
    returning id
  )
  insert into public.job_runs (job_type, entity_id, business_id, dedupe_key)
  select 'reconcile', closed.id, p_order.business_id, 'payment:' || closed.id from closed
  on conflict (job_type, dedupe_key) do nothing;
$$;

--
-- Name: committed_units(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.committed_units(p_capacity_id uuid, p_preorder_item_id uuid) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(sum(reservation.quantity), 0)
  from public.capacity_reservations as reservation
  where reservation.capacity_id = p_capacity_id
    and (p_preorder_item_id is null or reservation.preorder_item_id = p_preorder_item_id)
    and (reservation.state = 'allocated' or (reservation.state = 'held' and reservation.expires_at > now()));
$$;

--
-- Name: cost_changed(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.cost_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 UPDATE public.campaigns SET costs_completeness='unreviewed' WHERE id=NEW.campaign_id;
 RETURN NEW;
END $$;

--
-- Name: current_order_offer(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.current_order_offer(p_preorder_id uuid) RETURNS TABLE(discount_bps integer, pricing_campaign_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(active.discount_bps, 0), active.id
  from (select 1) as anchor
  left join lateral (
    select campaign.id, campaign.discount_bps
    from public.campaigns as campaign
    join public.preorders as preorder
      on preorder.id = campaign.preorder_id and preorder.business_id = campaign.business_id
    where campaign.preorder_id = p_preorder_id
      and campaign.status = 'published'
      and campaign.closed_at is null
      and campaign.published_at is not null
      and campaign.offer_type = 'percent_discount'
      and campaign.discount_bps between 1 and 9999
      and now() >= greatest(campaign.starts_at, campaign.published_at)
      and now() < campaign.ends_at
      and preorder.status = 'published'
      and now() < preorder.ends_at
    limit 1
  ) as active on true;
$$;

--
-- Name: current_owner_business(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.current_owner_business() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_business_id uuid;
begin
  select member.business_id into v_business_id
  from public.business_members as member
  where member.user_id = auth.uid() and member.role = 'owner';

  if v_business_id is null then
    raise exception 'PREORDER_NOT_FOUND' using errcode = '42501';
  end if;
  return v_business_id;
end;
$$;

--
-- Name: discount_per_unit(bigint, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.discount_per_unit(p_base_price_idr bigint, p_discount_bps integer) RETURNS bigint
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
BEGIN
  IF p_base_price_idr IS NULL OR p_base_price_idr NOT BETWEEN 1 AND 1000000000
     OR p_discount_bps IS NULL OR p_discount_bps NOT BETWEEN 0 AND 9999 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  RETURN floor(p_base_price_idr::numeric * p_discount_bps / 10000)::bigint;
END;
$$;

--
-- Name: enqueue_paid_email(public.orders); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.enqueue_paid_email(p_order public.orders) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  insert into public.job_runs (job_type, entity_id, business_id, dedupe_key)
  values ('send_paid_email', p_order.id, p_order.business_id, p_order.id || ':paid-v1')
  on conflict (job_type, dedupe_key) do nothing;
$$;

--
-- Name: finish_memory_index_job(uuid, uuid, integer, uuid, text, integer, text, text, extensions.vector, text, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.finish_memory_index_job(p_business_id uuid, p_job_id uuid, p_attempt_count integer, p_memory_id uuid, p_content_hash text, p_embedding_version integer, p_model text, p_profile text, p_embedding extensions.vector, p_error_code text, p_max_attempts integer) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
DECLARE m public.campaign_memories; j public.job_runs; k text; effective_embedding extensions.vector;
BEGIN
 SELECT * INTO STRICT m FROM public.campaign_memories WHERE id=p_memory_id AND business_id=p_business_id FOR UPDATE;
 SELECT * INTO STRICT j FROM public.job_runs WHERE id=p_job_id AND business_id=p_business_id AND job_type='embed_memory' FOR UPDATE;
 k:=jsonb_build_array(m.id,p_embedding_version,p_content_hash,p_model,p_profile)::text;
 IF j.entity_id IS DISTINCT FROM m.id OR j.dedupe_key IS DISTINCT FROM k OR
    (m.content_hash,m.embedding_version,m.embedding_model,m.embedding_profile,m.review_status) IS DISTINCT FROM
    (p_content_hash,p_embedding_version,p_model,p_profile,'approved'::text) THEN
  RAISE EXCEPTION 'STALE_EMBEDDING_JOB' USING ERRCODE='40001';
 END IF;
 IF p_error_code IS NULL AND j.status='succeeded' AND j.attempt_count=p_attempt_count AND j.provider_reference=p_content_hash AND
    m.embedding_status='ready' AND m.embedding IS NOT NULL THEN RETURN; END IF;
 IF j.status<>'running' OR p_attempt_count IS NULL OR j.attempt_count<>p_attempt_count OR
    j.locked_until IS NULL OR j.locked_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'STALE_JOB_LEASE' USING ERRCODE='40001';
 END IF;
 IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 OR
    (p_error_code IS NOT NULL AND (p_error_code !~ '^[A-Z_]{1,64}$' OR p_embedding IS NOT NULL)) THEN
  RAISE EXCEPTION 'INVALID_MEMORY_JOB_RESULT' USING ERRCODE='22023';
 END IF;
 IF p_error_code IS NOT NULL THEN
  UPDATE public.campaign_memories SET embedding_status='failed' WHERE id=m.id AND embedding_status IN ('queued','failed');
  UPDATE public.job_runs SET status=CASE WHEN attempt_count>=p_max_attempts THEN 'dead' ELSE 'retryable_failed' END,
   locked_until=NULL,last_error_code=p_error_code,provider_reference=NULL,
   finished_at=CASE WHEN attempt_count>=p_max_attempts THEN clock_timestamp() ELSE NULL END,
   next_run_at=clock_timestamp()+interval '30 seconds' WHERE id=j.id;
  RETURN;
 END IF;
 -- pgvector itself rejects NaN/Infinity on input; the norm additionally rejects zero/overflow.
 effective_embedding:=coalesce(p_embedding,CASE WHEN m.embedding_status='ready' THEN m.embedding END);
 IF effective_embedding IS NULL OR extensions.vector_dims(effective_embedding)<>768 OR
    NOT (extensions.vector_norm(effective_embedding)>0 AND extensions.vector_norm(effective_embedding)<'Infinity'::float8) THEN
  RAISE EXCEPTION 'INVALID_EMBEDDING' USING ERRCODE='22023';
 END IF;
 IF m.embedding_status NOT IN ('queued','failed','ready') THEN RAISE EXCEPTION 'STALE_EMBEDDING_JOB' USING ERRCODE='40001'; END IF;
 IF m.embedding_status<>'ready' THEN
  UPDATE public.campaign_memories SET embedding=p_embedding,embedding_status='ready',indexed_at=clock_timestamp() WHERE id=m.id;
 END IF;
 UPDATE public.job_runs SET status='succeeded',locked_until=NULL,finished_at=clock_timestamp(),last_error_code=NULL,
  provider_reference=p_content_hash WHERE id=j.id;
END $_$;

--
-- Name: guard_blueprint(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_blueprint() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

--
-- Name: guard_campaign(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_campaign() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

--
-- Name: guard_campaign_completion(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_campaign_completion() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF OLD.status='completed' THEN
  RAISE EXCEPTION 'COMPLETED_CAMPAIGN_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NEW.status='completed' AND (current_user<>'postgres' OR OLD.status<>'closed' OR NOT EXISTS(
  SELECT 1 FROM public.campaign_evaluations e WHERE e.campaign_id=OLD.id AND e.evaluation_kind='final' AND
   (e.metrics_json#>>'{finalization,expectedCampaignVersion}')::integer=OLD.version AND
   (e.metrics_json#>>'{finalization,completedAt}')::timestamptz=NEW.completed_at AND
   e.id=(SELECT id FROM public.campaign_evaluations WHERE campaign_id=OLD.id ORDER BY created_at DESC,id DESC LIMIT 1))) THEN
  RAISE EXCEPTION 'ATOMIC_FINALIZATION_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

--
-- Name: guard_capacity(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_capacity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

--
-- Name: guard_capacity_update(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_capacity_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  committed_units bigint;
begin
  if new.total_units < old.total_units then
    select coalesce(sum(reservation.quantity), 0)
    into committed_units
    from public.capacity_reservations as reservation
    where reservation.capacity_id = old.id
      and (
        reservation.state = 'allocated'
        or (reservation.state = 'held' and reservation.expires_at > now())
      );

    if new.total_units < committed_units then
      raise exception 'CAPACITY_BELOW_COMMITMENT';
    end if;
  end if;

  -- Cutoff dibekukan setelah publish (D-13).
  if (new.intake_cutoff_at, new.fulfillment_window_end_at)
       is distinct from (old.intake_cutoff_at, old.fulfillment_window_end_at)
     and exists (
       select 1
       from public.preorder_items as item
       join public.preorders as preorder on preorder.id = item.preorder_id
       where item.capacity_id = old.id
         and preorder.status = 'published'
     ) then
    raise exception 'CAPACITY_SCHEDULE_FROZEN';
  end if;

  return new;
end;
$$;

--
-- Name: guard_evaluation_insert(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_evaluation_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE c public.campaigns; latest uuid; last_created timestamptz;
BEGIN
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=NEW.campaign_id FOR UPDATE;
 IF c.status='completed' THEN RAISE EXCEPTION 'COMPLETED_CAMPAIGN_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT id,created_at INTO latest,last_created FROM public.campaign_evaluations WHERE campaign_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF NEW.metrics_json ? 'cas' THEN
  IF (NEW.metrics_json#>>'{cas,expectedEvaluationId}')::uuid IS DISTINCT FROM latest THEN
   RAISE EXCEPTION 'STALE_EVALUATION_VERSION' USING ERRCODE='40001';
  END IF;
  PERFORM private.check_evaluation_sources(c.id,NEW.metrics_json->'context');
 END IF;
 -- Clock order is assigned under the parent lock, including legacy insert writers.
 NEW.created_at:=greatest(clock_timestamp(),last_created+interval '1 microsecond');
 NEW.evaluated_at:=NEW.created_at;
 RETURN NEW;
END $$;

--
-- Name: guard_evaluation_source_write(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_evaluation_source_write() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE c public.campaigns;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.business_id,NEW.campaign_id) IS DISTINCT FROM (OLD.business_id,OLD.campaign_id) THEN
  RAISE EXCEPTION 'SOURCE_BINDING_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=NEW.campaign_id FOR UPDATE;
 IF c.business_id IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'SOURCE_SCOPE_MISMATCH' USING ERRCODE='23514'; END IF;
 IF c.status='completed' THEN RAISE EXCEPTION 'COMPLETED_CAMPAIGN_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

--
-- Name: guard_memory(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_memory() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF OLD.review_status='approved' AND (NEW.summary_text,NEW.lessons_json,NEW.limitations_json,NEW.content_hash,
  NEW.source_evaluation_id,NEW.source_blueprint_id,NEW.source_version,NEW.business_id,NEW.campaign_id)
  IS DISTINCT FROM (OLD.summary_text,OLD.lessons_json,OLD.limitations_json,OLD.content_hash,
  OLD.source_evaluation_id,OLD.source_blueprint_id,OLD.source_version,OLD.business_id,OLD.campaign_id) THEN
  RAISE EXCEPTION 'APPROVED_MEMORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

--
-- Name: guard_memory_job(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_memory_job() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.job_type='embed_memory' AND
    (NEW.job_type,NEW.entity_id,NEW.business_id,NEW.dedupe_key) IS DISTINCT FROM
    (OLD.job_type,OLD.entity_id,OLD.business_id,OLD.dedupe_key) THEN
  RAISE EXCEPTION 'MEMORY_JOB_BINDING_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF NEW.job_type='embed_memory' AND current_user<>'postgres' THEN
  RAISE EXCEPTION 'ATOMIC_MEMORY_INDEXING_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

--
-- Name: guard_memory_pipeline(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_memory_pipeline() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 -- Keep the existing synthetic error even for a direct privileged attempt.
 IF NEW.review_status='approved' AND EXISTS(SELECT 1 FROM public.campaign_evaluations e WHERE e.id=NEW.source_evaluation_id
  AND e.metrics_json#>>'{finalization,mode}'='development_synthetic') THEN
  RAISE EXCEPTION 'SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN' USING ERRCODE='23514';
 END IF;
 IF current_user<>'postgres' AND (NEW.review_status='approved' OR NEW.embedding IS NOT NULL OR NEW.embedding_status='ready') THEN
  RAISE EXCEPTION 'ATOMIC_MEMORY_INDEXING_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.review_status='approved' AND NEW.review_status<>'approved' THEN
  RAISE EXCEPTION 'APPROVED_MEMORY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

--
-- Name: guard_order_items(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_order_items() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'IMMUTABLE_ORDER_SNAPSHOT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

--
-- Name: guard_payment(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_payment() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF OLD.applied_at IS NOT NULL AND (NEW.applied_at,NEW.order_id,NEW.business_id,NEW.amount_idr,NEW.status,NEW.provider_order_id)
  IS DISTINCT FROM (OLD.applied_at,OLD.order_id,OLD.business_id,OLD.amount_idr,OLD.status,OLD.provider_order_id) THEN
  RAISE EXCEPTION 'APPLIED_PAYMENT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

--
-- Name: guard_preorder(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_preorder() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

--
-- Name: guard_preorder_item(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_preorder_item() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

--
-- Name: guard_reservation(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_reservation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

--
-- Name: guard_synthetic_finalization_memory(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_synthetic_finalization_memory() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF NEW.review_status='approved' AND EXISTS(SELECT 1 FROM public.campaign_evaluations e
  WHERE e.id=NEW.source_evaluation_id AND e.metrics_json#>>'{finalization,mode}'='development_synthetic') THEN
  RAISE EXCEPTION 'SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

--
-- Name: preorders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.preorders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    slug character varying(160),
    status text DEFAULT 'draft'::text NOT NULL,
    fulfillment_date date NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    published_at timestamp with time zone,
    closed_at timestamp with time zone,
    completed_at timestamp with time zone,
    pickup_terms_snapshot jsonb,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT preorders_check CHECK ((starts_at < ends_at)),
    CONSTRAINT preorders_check1 CHECK (((status <> 'published'::text) OR ((published_at IS NOT NULL) AND (slug IS NOT NULL)))),
    CONSTRAINT preorders_pickup_terms_snapshot_check CHECK ((jsonb_typeof(pickup_terms_snapshot) = 'object'::text)),
    CONSTRAINT preorders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'closed'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT preorders_version_check CHECK ((version > 0))
);

--
-- Name: insert_order(public.preorders, public.preorder_items, text, text, text, text, text, text, text, integer, text, text, text, text, timestamp with time zone, integer, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.insert_order(p_preorder public.preorders, p_item public.preorder_items, p_source text, p_payment_mode text, p_external_payment_status text, p_order_status text, p_customer_name text, p_customer_email text, p_customer_contact text, p_quantity integer, p_token_hash text, p_idempotency_key text, p_request_hash text, p_reservation_state text, p_payment_due_at timestamp with time zone, p_discount_bps integer, p_pricing_campaign_id uuid, p_attribution_campaign_id uuid) RETURNS public.orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_product public.products;
  v_order public.orders;
  v_order_item_id uuid;
  v_discount_per_unit bigint;
  v_final_unit_price bigint;
begin
  -- Bound the undiscounted subtotal before bigint arithmetic or any persistent side effect.
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000
     OR p_item.base_price_snapshot_idr IS NULL OR p_item.base_price_snapshot_idr NOT BETWEEN 1 AND 1000000000
     OR p_item.base_price_snapshot_idr::numeric * p_quantity > 1000000000 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  v_discount_per_unit := private.discount_per_unit(p_item.base_price_snapshot_idr, p_discount_bps);
  v_final_unit_price := p_item.base_price_snapshot_idr - v_discount_per_unit;

  select * into v_product from public.products as product where product.id = p_item.product_id;
  IF v_product.variable_cost_idr IS NOT NULL AND v_product.variable_cost_idr NOT BETWEEN 0 AND 1000000000 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;

  insert into public.orders (
    business_id, preorder_id, attribution_campaign_id, pricing_campaign_id, public_order_number, private_token_hash, idempotency_key, request_hash, source,
    customer_name, customer_email, customer_contact, fulfillment_date, payment_mode, external_payment_status,
    external_payment_confirmed_at, order_status, fulfillment_status, subtotal_idr, discount_total_idr, total_idr, payment_due_at
  ) values (
    p_preorder.business_id, p_preorder.id, p_attribution_campaign_id, p_pricing_campaign_id, private.new_order_number(), p_token_hash, p_idempotency_key, p_request_hash, p_source,
    p_customer_name, p_customer_email, p_customer_contact, p_preorder.fulfillment_date, p_payment_mode, p_external_payment_status,
    case when p_external_payment_status = 'confirmed' then now() end,
    p_order_status, 'pending_confirmation',
    p_quantity * p_item.base_price_snapshot_idr, p_quantity * v_discount_per_unit, p_quantity * v_final_unit_price, p_payment_due_at
  ) returning * into v_order;

  insert into public.order_items (
    business_id, order_id, preorder_item_id, product_id, product_name_snapshot, sku_snapshot, quantity,
    base_unit_price_idr, discount_bps_snapshot, discount_per_unit_idr, final_unit_price_idr,
    variable_cost_per_unit_idr, cost_quality_snapshot, line_total_idr, pricing_campaign_id
  ) values (
    p_preorder.business_id, v_order.id, p_item.id, p_item.product_id, p_item.product_name_snapshot, p_item.sku_snapshot, p_quantity,
    p_item.base_price_snapshot_idr, p_discount_bps, v_discount_per_unit, v_final_unit_price,
    v_product.variable_cost_idr, v_product.cost_quality, p_quantity * v_final_unit_price, p_pricing_campaign_id
  ) returning id into v_order_item_id;

  insert into public.capacity_reservations (business_id, order_id, order_item_id, preorder_item_id, capacity_id, quantity, state, expires_at)
  values (p_preorder.business_id, v_order.id, v_order_item_id, p_item.id, p_item.capacity_id, p_quantity, p_reservation_state, p_payment_due_at);

  perform private.record_order_event(
    p_preorder.business_id, v_order.id, 'order_created', null, p_order_status,
    jsonb_build_object('source', p_source, 'quantity', p_quantity)
  );
  return v_order;
end;
$$;

--
-- Name: is_business_owner(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_business_owner(p_business_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.business_members
    where business_id = p_business_id
      and user_id = (select auth.uid())
  );
$$;

--
-- Name: job_backoff(integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.job_backoff(p_attempt integer) RETURNS interval
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case p_attempt when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '15 minutes' else interval '60 minutes' end;
$$;

--
-- Name: lock_campaign_context(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.lock_campaign_context(p_campaign_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE camp public.campaigns; po public.preorders; item public.preorder_items;
 cap public.production_capacity; prod public.products; used bigint; event_used bigint; paid bigint;
BEGIN
 SELECT * INTO STRICT camp FROM public.campaigns WHERE id=p_campaign_id;
 SELECT * INTO STRICT item FROM public.preorder_items WHERE preorder_id=camp.preorder_id;
 -- Preorder dikunci sebelum kapasitas, sama dengan checkout dan fungsi inti lain. Urutan terbalik deadlock dengan checkout.
 SELECT * INTO STRICT po FROM public.preorders WHERE id=camp.preorder_id FOR UPDATE;
 SELECT * INTO STRICT cap FROM public.production_capacity WHERE id=item.capacity_id FOR UPDATE;
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

--
-- Name: lock_order(uuid, integer, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.lock_order(p_order_id uuid, p_expected_version integer, p_business_id uuid) RETURNS public.orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_order public.orders;
begin
  select * into v_order
  from public.orders as customer_order
  where customer_order.id = p_order_id and (p_business_id is null or customer_order.business_id = p_business_id)
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  -- Only the real service-role expiry path has no owner scope and may omit CAS.
  if p_expected_version is null and (p_business_id is null
      and auth.uid() is null and auth.role() = 'service_role'
      and current_setting('role', true) = 'service_role') IS NOT TRUE then
    raise exception 'VERSION_CONFLICT';
  end if;
  if p_expected_version is not null and (p_expected_version <= 0 or v_order.version is distinct from p_expected_version) then
    raise exception 'VERSION_CONFLICT';
  end if;
  return v_order;
end;
$$;

--
-- Name: lock_order_context(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.lock_order_context(p_order_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

--
-- Name: lock_owned_preorder(uuid, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.lock_owned_preorder(p_preorder_id uuid, p_expected_version integer) RETURNS public.preorders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_preorder public.preorders;
begin
  select * into v_preorder
  from public.preorders as preorder
  where preorder.id = p_preorder_id and preorder.business_id = private.current_owner_business()
  for update;

  if not found then
    raise exception 'PREORDER_NOT_FOUND';
  end if;
  if p_expected_version is null or p_expected_version <= 0 or v_preorder.version is distinct from p_expected_version then
    raise exception 'PREORDER_VERSION_CONFLICT';
  end if;
  return v_preorder;
end;
$$;

--
-- Name: new_order_number(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.new_order_number() RETURNS text
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select 'CL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

--
-- Name: order_result(public.orders, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.order_result(p_order public.orders, p_replayed boolean) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'order_id', p_order.id,
    'public_order_number', p_order.public_order_number,
    'order_status', p_order.order_status,
    'total_idr', p_order.total_idr,
    'payment_due_at', p_order.payment_due_at,
    'replayed', p_replayed
  );
$$;

--
-- Name: owns_product_photo(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.owns_product_photo(p_object_name text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $_$
  select case
    when split_part(p_object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_business_owner(split_part(p_object_name, '/', 1)::uuid)
    else false
  end;
$_$;

--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    order_id uuid NOT NULL,
    provider text DEFAULT 'midtrans_sandbox'::text NOT NULL,
    provider_order_id text NOT NULL,
    provider_transaction_id text,
    attempt_number integer NOT NULL,
    amount_idr bigint NOT NULL,
    status text NOT NULL,
    is_active_attempt boolean NOT NULL,
    qr_content text,
    qr_expires_at timestamp with time zone,
    provider_paid_at timestamp with time zone,
    verified_at timestamp with time zone,
    applied_at timestamp with time zone,
    review_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_idr_check CHECK ((amount_idr >= 0)),
    CONSTRAINT payments_amount_idr_check1 CHECK ((amount_idr > 0)),
    CONSTRAINT payments_attempt_number_check CHECK ((attempt_number > 0)),
    CONSTRAINT payments_check CHECK (((applied_at IS NULL) OR ((status = 'paid_sandbox'::text) AND (verified_at IS NOT NULL) AND (provider_paid_at IS NOT NULL)))),
    CONSTRAINT payments_provider_check CHECK ((provider = 'midtrans_sandbox'::text)),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['initiating'::text, 'pending'::text, 'paid_sandbox'::text, 'expired'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT payments_version_check CHECK ((version > 0))
);

--
-- Name: payment_attempt_result(public.payments, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.payment_attempt_result(p_payment public.payments, p_action text) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'action', p_action,
    'payment_id', p_payment.id,
    'provider_order_id', p_payment.provider_order_id,
    'attempt_number', p_payment.attempt_number,
    'amount_idr', p_payment.amount_idr,
    'status', p_payment.status,
    'qr_content', p_payment.qr_content,
    'qr_expires_at', p_payment.qr_expires_at
  );
$$;

--
-- Name: publish_preorder_canonical(uuid, uuid, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.publish_preorder_canonical(p_business_id uuid, p_preorder_id uuid, p_expected_version integer) RETURNS public.preorders
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
 v_preorder public.preorders;
 v_item public.preorder_items;
 v_capacity public.production_capacity;
 v_product public.products;
 v_business public.businesses;
 v_committed_units bigint;
BEGIN
 SELECT * INTO v_preorder FROM public.preorders
 WHERE id=p_preorder_id AND business_id=p_business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PREORDER_NOT_FOUND'; END IF;
 IF p_expected_version IS NULL OR v_preorder.version IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'PREORDER_VERSION_CONFLICT';
 END IF;
 IF v_preorder.status<>'draft' THEN RAISE EXCEPTION 'PREORDER_NOT_DRAFT'; END IF;

 SELECT * INTO v_item FROM public.preorder_items WHERE preorder_id=p_preorder_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PREORDER_INPUT_INVALID'; END IF;
 SELECT * INTO v_capacity FROM public.production_capacity WHERE id=v_item.capacity_id FOR UPDATE;
 SELECT * INTO v_product FROM public.products WHERE id=v_item.product_id;
 SELECT * INTO v_business FROM public.businesses WHERE id=p_business_id;
 IF NOT v_product.is_active THEN RAISE EXCEPTION 'PREORDER_PRODUCT_INACTIVE'; END IF;
 IF v_preorder.starts_at>=v_preorder.ends_at OR v_preorder.ends_at>v_capacity.intake_cutoff_at
  OR v_capacity.intake_cutoff_at>=v_capacity.fulfillment_window_end_at OR v_preorder.ends_at<=now() THEN
  RAISE EXCEPTION 'PREORDER_SCHEDULE_INVALID';
 END IF;
 SELECT coalesce(sum(quantity),0) INTO v_committed_units FROM public.capacity_reservations
 WHERE capacity_id=v_capacity.id AND (state='allocated' OR (state='held' AND expires_at>now()));
 IF v_item.quota_units>v_capacity.total_units-v_committed_units THEN
  RAISE EXCEPTION 'PREORDER_QUOTA_OVER_CAPACITY';
 END IF;

 UPDATE public.preorder_items SET base_price_snapshot_idr=v_product.base_price_idr,
  product_name_snapshot=v_product.name,sku_snapshot=v_product.sku WHERE id=v_item.id;
 BEGIN
  UPDATE public.preorders SET status='published',published_at=now(),pickup_terms_snapshot=jsonb_build_object(
   'pickup_instructions',v_business.pickup_instructions,'public_contact',v_business.public_contact,
   'intake_cutoff_at',v_capacity.intake_cutoff_at,'fulfillment_window_end_at',v_capacity.fulfillment_window_end_at)
  WHERE id=p_preorder_id RETURNING * INTO v_preorder;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'PREORDER_DATE_TAKEN';
 END;
 RETURN v_preorder;
END $$;

--
-- Name: record_order_event(uuid, uuid, text, text, text, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.record_order_event(p_business_id uuid, p_order_id uuid, p_event_type text, p_from_state text, p_to_state text, p_details jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  insert into public.order_events (business_id, order_id, event_type, from_state, to_state, actor_type, actor_user_id, details_json)
  values (
    p_business_id, p_order_id, p_event_type, p_from_state, p_to_state,
    case when auth.uid() is null then 'system' else 'owner' end,
    auth.uid(),
    p_details
  );
$$;

--
-- Name: require_owner(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_owner(p_business_id uuid, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: resolve_attribution(uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.resolve_attribution(p_preorder_id uuid, p_attribution_ref text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select campaign.id
  from public.campaigns as campaign
  join public.preorders as preorder
    on preorder.id = campaign.preorder_id and preorder.business_id = campaign.business_id
  where p_attribution_ref is not null
    and campaign.slug = p_attribution_ref
    and campaign.preorder_id = p_preorder_id
    and campaign.status = 'published'
    and campaign.closed_at is null
    and campaign.published_at is not null
    and now() >= greatest(campaign.starts_at, campaign.published_at)
    and now() < campaign.ends_at
    and preorder.status = 'published'
    and now() < preorder.ends_at
  limit 1;
$$;

--
-- Name: sync_business_category(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.sync_business_category() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.categories is null then
    new.categories := array[new.category::text];
  end if;
  new.category := left(new.categories[1], 80);
  return new;
end;
$$;

--
-- Name: touch_row(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.touch_row() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 NEW.updated_at:=clock_timestamp();
 IF to_jsonb(NEW) ? 'version' THEN
  IF NEW.version=OLD.version THEN NEW.version:=OLD.version+1;
  ELSIF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN NEW;
END $$;

--
-- Name: accept_late_payment(uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_late_payment(p_order_id uuid, p_expected_version integer, p_payment_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_business_id uuid := private.current_owner_business();
  v_order public.orders;
  v_order_item public.order_items;
  v_item public.preorder_items;
  v_capacity public.production_capacity;
  v_payment public.payments;
  v_previous_status text;
begin
  select * into v_order_item
  from public.order_items as item
  where item.order_id = p_order_id and item.business_id = v_business_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  -- Pesanan dikunci sebelum preorder dan kapasitas, sama dengan settlement dan expire_or_cancel_order.
  -- Urutan sebelumnya (kapasitas lalu pesanan) terbukti deadlock (40P01) dengan settlement pesanan yang sama.
  v_order := private.lock_order(p_order_id, p_expected_version, v_business_id);

  perform 1 from public.preorders as preorder
  where preorder.id = (select item.preorder_id from public.preorder_items as item where item.id = v_order_item.preorder_item_id)
  for share;
  select * into v_item from public.preorder_items as item where item.id = v_order_item.preorder_item_id;
  select * into v_capacity from public.production_capacity as capacity where capacity.id = v_item.capacity_id for update;

  v_previous_status := v_order.order_status;

  select * into v_payment
  from public.payments as payment
  where payment.id = p_payment_id and payment.order_id = p_order_id and payment.status = 'paid_sandbox' and payment.applied_at is null
  for update;

  if v_order.order_status <> 'requires_review'
     or v_payment.id is null
     or now() >= v_capacity.fulfillment_window_end_at
     or exists (select 1 from public.payments as payment where payment.order_id = p_order_id and payment.applied_at is not null) then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  perform private.assert_orderable(v_capacity, v_item, v_order_item.quantity);

  update public.capacity_reservations
  set state = 'allocated', expires_at = null, released_at = null, release_reason = null
  where order_item_id = v_order_item.id;
  update public.payments set applied_at = now(), review_reason = null where id = p_payment_id;
  update public.orders
  set order_status = 'awaiting_confirmation', fulfillment_status = 'pending_confirmation', cancelled_at = null, cancel_reason = null, review_reason = null
  where id = p_order_id
  returning * into v_order;

  perform private.record_order_event(v_order.business_id, p_order_id, 'late_payment_accepted', v_previous_status, 'awaiting_confirmation', jsonb_build_object('payment_id', p_payment_id));
  perform private.enqueue_paid_email(v_order);
end;
$$;

--
-- Name: admit_ai_generation(uuid, uuid, uuid, text, text, text, text, uuid, uuid, integer, text, text, text, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admit_ai_generation(p_business_id uuid, p_actor_user_id uuid, p_generation_id uuid, p_generation_type text, p_request_key text, p_input_hash text, p_model_id text, p_preorder_id uuid, p_session_id uuid, p_expected_version integer, p_context_hash text, p_message text, p_minute_key_hash text, p_hour_key_hash text, p_day_key_hash text, p_daily_limit integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
 gen public.ai_generations; turn jsonb; admitted boolean := false;
 admitted_at timestamptz; minute_start timestamptz; hour_start timestamptz; day_start timestamptz;
 minute_end timestamptz; hour_end timestamptz; day_end timestamptz;
 minute_ok boolean; hour_ok boolean; day_ok boolean; denied_window text; retry_after integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 IF p_generation_type NOT IN ('discussion','blueprint','evaluation','memory') OR
    p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 128 OR
    p_input_hash !~ '^[0-9a-f]{64}$' OR p_model_id IS NULL OR length(p_model_id) NOT BETWEEN 1 AND 128 OR
    p_daily_limit IS NULL OR p_daily_limit < 1 OR
    p_minute_key_hash !~ '^[0-9a-f]{64}$' OR p_hour_key_hash !~ '^[0-9a-f]{64}$' OR p_day_key_hash !~ '^[0-9a-f]{64}$' OR
    p_minute_key_hash = p_hour_key_hash OR p_minute_key_hash = p_day_key_hash OR p_hour_key_hash = p_day_key_hash OR
    (p_generation_type = 'discussion' AND (p_session_id IS NULL OR p_generation_id IS NOT NULL OR p_preorder_id IS NOT NULL)) OR
    (p_generation_type <> 'discussion' AND (p_session_id IS NOT NULL OR p_generation_id IS NULL OR p_preorder_id IS NULL OR
      p_expected_version IS NOT NULL OR p_context_hash IS NOT NULL OR p_message IS NOT NULL)) THEN
  RAISE EXCEPTION 'INVALID_ADMISSION_INPUT' USING ERRCODE='22023';
 END IF;
 -- A business row serializes distinct sessions and modules before the authoritative clock is sampled.
 PERFORM 1 FROM public.businesses WHERE id=p_business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 admitted_at := clock_timestamp();
 minute_start := date_trunc('minute',admitted_at,'UTC'); minute_end := minute_start + interval '1 minute';
 hour_start := date_trunc('hour',admitted_at,'UTC'); hour_end := hour_start + interval '1 hour';
 day_start := date_trunc('day',admitted_at,'Asia/Jakarta'); day_end := day_start + interval '1 day';

 BEGIN
  IF p_generation_type = 'discussion' THEN
   -- Keep existing session/version/context/user-message semantics inside the same subtransaction.
   turn := public.claim_ai_generation(p_business_id,p_session_id,p_expected_version,p_context_hash,
     p_request_key,p_input_hash,p_model_id,p_message,p_generation_type,p_actor_user_id);
   IF turn->>'status' <> 'claimed' THEN RETURN turn; END IF;
   admitted := true;
  ELSE
   SELECT * INTO gen FROM public.ai_generations WHERE business_id=p_business_id AND generation_type=p_generation_type
     AND request_key=p_request_key FOR UPDATE;
   IF FOUND THEN
    IF gen.preorder_id IS DISTINCT FROM p_preorder_id OR gen.input_hash IS DISTINCT FROM p_input_hash OR
       gen.session_id IS NOT NULL OR gen.campaign_id IS NOT NULL THEN
     RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001';
    END IF;
    RETURN jsonb_build_object('status',gen.status,'generationId',gen.id,'output',gen.output_json,'errorCode',gen.error_code);
   END IF;
   INSERT INTO public.ai_generations(id,business_id,preorder_id,campaign_id,session_id,generation_type,
     request_key,input_hash,model_id,status,started_at)
   VALUES(p_generation_id,p_business_id,p_preorder_id,NULL,NULL,p_generation_type,
     p_request_key,p_input_hash,p_model_id,'running',admitted_at) RETURNING * INTO gen;
   admitted := true;
  END IF;
  IF admitted THEN
   minute_ok := public.take_rate_limit(p_minute_key_hash,minute_start,minute_end,6);
   hour_ok := public.take_rate_limit(p_hour_key_hash,hour_start,hour_end,30);
   day_ok := public.take_rate_limit(p_day_key_hash,day_start,day_end,p_daily_limit);
   IF NOT (minute_ok AND hour_ok AND day_ok) THEN
    denied_window := CASE WHEN NOT day_ok THEN 'day' WHEN NOT hour_ok THEN 'hour' ELSE 'minute' END;
    retry_after := greatest(1,ceil(extract(epoch FROM greatest(
      CASE WHEN NOT minute_ok THEN minute_end ELSE admitted_at END,
      CASE WHEN NOT hour_ok THEN hour_end ELSE admitted_at END,
      CASE WHEN NOT day_ok THEN day_end ELSE admitted_at END) - clock_timestamp()))::integer);
    RAISE EXCEPTION 'AI_QUOTA_DENIED' USING ERRCODE='P0001';
   END IF;
  END IF;
  IF p_generation_type = 'discussion' THEN RETURN turn; END IF;
  RETURN jsonb_build_object('status','claimed','generationId',gen.id);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'AI_QUOTA_DENIED' THEN RAISE; END IF;
  -- PL/pgSQL rolls back every claim, message, version and bucket write in this block.
  RETURN jsonb_build_object('status','denied','window',denied_window,'retryAfter',retry_after);
 END;
END $_$;

--
-- Name: advance_fulfillment(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.advance_fulfillment(p_order_id uuid, p_expected_version integer, p_action text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_order public.orders := private.lock_order(p_order_id, p_expected_version, private.current_owner_business());
  v_is_closed boolean := v_order.order_status in ('expired', 'cancelled') or v_order.fulfillment_status = 'cancelled';
begin
  if v_is_closed then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  case p_action
    when 'mark_paid' then
      if v_order.external_payment_status is distinct from 'unpaid' then
        raise exception 'ORDER_STATE_INVALID';
      end if;
      update public.orders set external_payment_status = 'confirmed', external_payment_confirmed_at = now() where id = p_order_id;
      perform private.record_order_event(v_order.business_id, p_order_id, 'external_payment_confirmed', 'unpaid', 'confirmed', null);

    when 'confirm' then
      -- Pesanan pembeli baru sampai `awaiting_confirmation` setelah pembayaran terverifikasi (R5).
      if v_order.order_status <> 'awaiting_confirmation' or v_order.fulfillment_status <> 'pending_confirmation'
         or v_order.external_payment_status = 'unpaid' then
        raise exception 'ORDER_STATE_INVALID';
      end if;
      update public.orders set order_status = 'active', fulfillment_status = 'confirmed', confirmed_at = now() where id = p_order_id;
      perform private.record_order_event(v_order.business_id, p_order_id, 'order_confirmed', v_order.fulfillment_status, 'confirmed', null);

    when 'start_production' then
      if v_order.order_status <> 'active' or v_order.fulfillment_status <> 'confirmed' then
        raise exception 'ORDER_STATE_INVALID';
      end if;
      update public.orders set fulfillment_status = 'in_production', production_started_at = now() where id = p_order_id;
      -- Biaya dibukukan saat produksi mulai; NULL berarti belum diketahui, bukan nol. Unique menjaganya sekali per item.
      insert into public.order_production_costs (business_id, order_item_id, cost_kind, quantity, cost_per_unit_idr, amount_idr, quality, incurred_at)
      select item.business_id, item.id, 'variable_production', item.quantity, item.variable_cost_per_unit_idr,
             item.quantity * item.variable_cost_per_unit_idr,
             case when item.variable_cost_per_unit_idr is null then 'unknown' else item.cost_quality_snapshot end,
             now()
      from public.order_items as item
      where item.order_id = p_order_id
      on conflict (order_item_id, cost_kind) do nothing;
      perform private.record_order_event(v_order.business_id, p_order_id, 'production_started', 'confirmed', 'in_production', null);

    when 'mark_ready' then
      if v_order.fulfillment_status <> 'in_production' then
        raise exception 'ORDER_STATE_INVALID';
      end if;
      update public.orders set fulfillment_status = 'ready', ready_at = now() where id = p_order_id;
      perform private.record_order_event(v_order.business_id, p_order_id, 'order_ready', 'in_production', 'ready', null);

    when 'fulfill' then
      if v_order.fulfillment_status <> 'ready' then
        raise exception 'ORDER_STATE_INVALID';
      end if;
      update public.orders set fulfillment_status = 'fulfilled', fulfilled_at = now() where id = p_order_id;
      perform private.record_order_event(v_order.business_id, p_order_id, 'order_fulfilled', 'ready', 'fulfilled', null);

    else
      raise exception 'VALIDATION_ERROR';
  end case;
end;
$$;

--
-- Name: apply_verified_payment(text, text, text, text, text, bigint, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_verified_payment(p_provider_order_id text, p_provider_event_key text, p_payload_hash text, p_provider_status text, p_provider_transaction_id text, p_amount_idr bigint, p_provider_paid_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_payment_id uuid;
  v_order_id uuid;
  v_order public.orders;
  v_payment public.payments;
  v_event public.payment_events;
  v_hold public.capacity_reservations;
  v_terminal_status text := case p_provider_status when 'expire' then 'expired' when 'cancel' then 'cancelled' when 'deny' then 'failed' when 'failure' then 'failed' end;
  v_has_applied boolean;
  v_review_reason text;
  v_outcome text;
begin
  if coalesce(p_provider_order_id, '') = '' or coalesce(p_provider_event_key, '') = '' or coalesce(p_payload_hash, '') = ''
     or coalesce(p_provider_status, '') = '' or p_amount_idr is null then
    raise exception 'VALIDATION_ERROR';
  end if;

  select payment.id, payment.order_id into v_payment_id, v_order_id from public.payments as payment where payment.provider_order_id = p_provider_order_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  select * into v_order from public.orders as customer_order where customer_order.id = v_order_id for update;
  select * into v_payment from public.payments as payment where payment.id = v_payment_id for update;

  select * into v_event from public.payment_events as event where event.payment_id = v_payment.id and event.provider_event_key = p_provider_event_key;
  if found then
    v_outcome := case when v_event.provider_status <> p_provider_status or p_amount_idr <> v_payment.amount_idr then 'conflict' else 'duplicate' end;
    return jsonb_build_object(
      'outcome', v_outcome, 'payment_id', v_payment.id, 'order_id', v_order.id, 'order_status', v_order.order_status,
      'payload_changed', v_event.payload_hash <> p_payload_hash
    );
  end if;

  if p_amount_idr <> v_payment.amount_idr then
    v_outcome := 'amount_mismatch';

  elsif p_provider_status = 'settlement' then
    if v_payment.status = 'paid_sandbox' then
      v_outcome := 'ignored';
    else
      update public.payments
      set status = 'paid_sandbox',
          is_active_attempt = false,
          provider_paid_at = coalesce(p_provider_paid_at, now()),
          verified_at = now(),
          provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id)
      where id = v_payment.id;

      select exists (select 1 from public.payments as payment where payment.order_id = v_order.id and payment.applied_at is not null) into v_has_applied;

      if v_order.order_status = 'pending_payment' and not v_has_applied then
        select * into v_hold
        from public.capacity_reservations as reservation
        -- Waktu nyata setelah kunci pesanan didapat. now() adalah waktu mulai transaksi, jadi settlement yang tertahan kunci
        -- sampai lewat tenggat sebelumnya tetap menerapkan hold yang sudah kedaluwarsa.
        where reservation.order_id = v_order.id and reservation.state = 'held' and reservation.expires_at > clock_timestamp()
        for update;
      end if;

      if v_hold.id is not null then
        update public.payments set applied_at = now() where id = v_payment.id;
        update public.capacity_reservations set state = 'allocated', expires_at = null where id = v_hold.id;
        update public.orders set order_status = 'awaiting_confirmation' where id = v_order.id returning * into v_order;
        perform private.record_order_event(v_order.business_id, v_order.id, 'payment_applied', 'pending_payment', 'awaiting_confirmation', jsonb_build_object('payment_id', v_payment.id));
        perform private.enqueue_paid_email(v_order);
        v_outcome := 'applied';

      elsif v_has_applied then
        -- Pembayaran pertama tetap sah, jadi pesanan tidak diganggu. Fakta kedua dicatat agar pemilik bisa mengurus pengembaliannya.
        update public.payments set review_reason = 'duplicate_settlement' where id = v_payment.id;
        perform private.record_order_event(v_order.business_id, v_order.id, 'duplicate_settlement_recorded', null, null, jsonb_build_object('payment_id', v_payment.id));
        v_outcome := 'review';

      else
        v_review_reason := case v_order.order_status when 'cancelled' then 'order_cancelled' when 'expired' then 'order_expired' when 'requires_review' then 'additional_settlement' else 'hold_expired' end;
        update public.payments set review_reason = v_review_reason where id = v_payment.id;
        if v_order.order_status <> 'requires_review' then
          update public.capacity_reservations
          set state = 'released', released_at = now(), release_reason = 'expired'
          where order_id = v_order.id and state = 'held';
          update public.orders set order_status = 'requires_review', fulfillment_status = 'cancelled', review_reason = v_review_reason where id = v_order.id;
          perform private.record_order_event(v_order.business_id, v_order.id, 'late_payment_received', v_order.order_status, 'requires_review', jsonb_build_object('payment_id', v_payment.id));
        end if;
        v_outcome := 'review';
      end if;
    end if;

  elsif p_provider_status = 'pending' then
    -- Notifikasi lama tidak menurunkan status, jadi hanya percobaan yang baru dibuat yang berubah.
    update public.payments
    set status = 'pending', provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id)
    where id = v_payment.id and status = 'initiating';
    v_outcome := 'recorded';

  elsif v_terminal_status is not null then
    if v_payment.status = 'paid_sandbox' then
      v_outcome := 'ignored';
    else
      update public.payments set status = v_terminal_status, is_active_attempt = false where id = v_payment.id;
      v_outcome := 'recorded';
    end if;

  else
    v_outcome := 'ignored';
  end if;

  insert into public.payment_events (business_id, payment_id, provider_event_key, payload_hash, provider_status, signature_valid, verified_at, processed_at, outcome)
  values (v_order.business_id, v_payment.id, p_provider_event_key, p_payload_hash, p_provider_status, true, now(), now(), v_outcome);

  select * into v_order from public.orders as customer_order where customer_order.id = v_order_id;
  return jsonb_build_object('outcome', v_outcome, 'payment_id', v_payment.id, 'order_id', v_order.id, 'order_status', v_order.order_status, 'payload_changed', false);
end;
$$;

--
-- Name: apply_verified_payment(uuid, text, text, text, bigint, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_verified_payment(p_payment_id uuid, p_provider_order_id text, p_event_key text, p_payload_hash text, p_amount_idr bigint, p_provider_status text, p_provider_paid_at timestamp with time zone) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: campaign_blueprints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_blueprints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    version integer NOT NULL,
    approval_status text NOT NULL,
    blueprint_json jsonb NOT NULL,
    source_ai_generation_id uuid,
    context_hash text NOT NULL,
    approved_by_user_id uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_blueprints_approval_status_check CHECK ((approval_status = ANY (ARRAY['proposed'::text, 'approved'::text, 'discarded'::text]))),
    CONSTRAINT campaign_blueprints_blueprint_json_check CHECK ((jsonb_typeof(blueprint_json) = 'object'::text)),
    CONSTRAINT campaign_blueprints_check CHECK (((approval_status <> 'approved'::text) OR ((approved_at IS NOT NULL) AND (approved_by_user_id IS NOT NULL)))),
    CONSTRAINT campaign_blueprints_context_hash_check CHECK ((context_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT campaign_blueprints_version_check CHECK ((version > 0))
);

--
-- Name: approve_blueprint(uuid, uuid, jsonb, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_blueprint(p_business_id uuid, p_blueprint_id uuid, p_expected_versions jsonb, p_context_hash text, p_actor_user_id uuid) RETURNS public.campaign_blueprints
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: approve_campaign_memory(uuid, uuid, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_campaign_memory(p_business_id uuid, p_memory_id uuid, p_content_hash text, p_model text, p_profile text, p_actor_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE m public.campaign_memories;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 SELECT * INTO STRICT m FROM public.campaign_memories WHERE id=p_memory_id AND business_id=p_business_id;
 PERFORM private.lock_campaign_context(m.campaign_id);
 PERFORM 1 FROM public.campaign_memories WHERE id=m.id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.campaign_memories WHERE id=m.id AND content_hash=p_content_hash) THEN
  RAISE EXCEPTION 'MEMORY_SOURCE_CONFLICT' USING ERRCODE='40001';
 END IF;
 PERFORM private.check_memory_source(m.id);
 RETURN private.approve_memory_and_enqueue(p_business_id,m.id,p_content_hash,p_model,p_profile,p_actor_user_id);
END $$;

--
-- Name: cancel_preorder_draft(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_preorder_draft(p_preorder_id uuid, p_expected_version integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (private.lock_owned_preorder(p_preorder_id, p_expected_version)).status <> 'draft' then
    raise exception 'PREORDER_NOT_DRAFT';
  end if;

  update public.preorders set status = 'cancelled' where id = p_preorder_id;
end;
$$;

--
-- Name: cancel_published_preorder(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_published_preorder(p_preorder_id uuid, p_expected_version integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (private.lock_owned_preorder(p_preorder_id, p_expected_version)).status <> 'published' then
    raise exception 'PREORDER_NOT_PUBLISHED';
  end if;

  if exists (select 1 from public.orders as customer_order where customer_order.preorder_id = p_preorder_id) then
    raise exception 'PREORDER_HAS_ORDERS';
  end if;

  update public.preorders set status = 'cancelled' where id = p_preorder_id;
end;
$$;

--
-- Name: claim_ai_generation(uuid, uuid, integer, text, text, text, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_ai_generation(p_business_id uuid, p_session_id uuid, p_expected_version integer, p_context_hash text, p_request_key text, p_input_hash text, p_model_id text, p_message text, p_generation_type text DEFAULT 'discussion'::text, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: claim_jobs(text[], integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_jobs(p_job_types text[], p_limit integer, p_lease_seconds integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
 v_max_attempts constant integer := 5;
 v_claimed jsonb;
BEGIN
 IF coalesce(cardinality(p_job_types),0)=0 OR EXISTS (
  SELECT 1 FROM unnest(p_job_types) AS requested(job_type)
  WHERE requested.job_type IS NULL OR requested.job_type NOT IN ('expire','reconcile','send_paid_email')
 ) OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
   OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 3600 THEN
  RAISE EXCEPTION 'VALIDATION_ERROR';
 END IF;

 -- Exhaustion must neither wait on another worker nor touch another queue.
 WITH exhausted AS (
  SELECT job.id FROM public.job_runs AS job
  WHERE job.job_type=ANY(p_job_types) AND job.attempt_count>=v_max_attempts
   AND (job.status IN ('queued','retryable_failed') OR (job.status='running' AND job.locked_until<=clock_timestamp()))
  FOR UPDATE SKIP LOCKED
 )
 UPDATE public.job_runs AS job
 SET status='dead',finished_at=clock_timestamp(),locked_until=NULL,last_error_code=coalesce(job.last_error_code,'LEASE_EXPIRED')
 FROM exhausted WHERE job.id=exhausted.id;

 WITH ready AS (
  SELECT job.id FROM public.job_runs AS job
  WHERE job.job_type=ANY(p_job_types) AND job.attempt_count<v_max_attempts AND job.next_run_at<=clock_timestamp()
   AND (job.status IN ('queued','retryable_failed') OR (job.status='running' AND job.locked_until<=clock_timestamp()))
  ORDER BY job.next_run_at,job.created_at,job.id
  FOR UPDATE SKIP LOCKED LIMIT p_limit
 ), claimed AS (
  UPDATE public.job_runs AS job
  SET status='running',attempt_count=job.attempt_count+1,locked_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),finished_at=NULL
  FROM ready WHERE job.id=ready.id
  RETURNING job.id,job.job_type,job.entity_id,job.business_id,job.attempt_count
 )
 SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_claimed FROM claimed;
 RETURN v_claimed;
END $$;

--
-- Name: job_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_type text NOT NULL,
    entity_id uuid,
    business_id uuid,
    dedupe_key text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_until timestamp with time zone,
    last_error_code text,
    provider_reference text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT job_runs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT job_runs_job_type_check CHECK ((job_type = ANY (ARRAY['expire'::text, 'reconcile'::text, 'embed_memory'::text, 'send_paid_email'::text]))),
    CONSTRAINT job_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'retryable_failed'::text, 'dead'::text])))
);

--
-- Name: claim_jobs(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_jobs(p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 60, p_max_attempts integer DEFAULT 5) RETURNS SETOF public.job_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'TYPED_JOB_CLAIM_REQUIRED' USING ERRCODE='0A000';
END $$;

--
-- Name: claim_memory_jobs(uuid, text, text, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_memory_jobs(p_business_id uuid, p_model text, p_profile text, p_embedding_version integer, p_limit integer DEFAULT 5, p_lease_seconds integer DEFAULT 60, p_max_attempts integer DEFAULT 5) RETURNS SETOF public.job_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 IF p_business_id IS NULL OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 128 OR
    p_profile IS NULL OR length(p_profile) NOT BETWEEN 1 AND 128 OR p_embedding_version IS NULL OR p_embedding_version<1 OR
    p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 300 OR
    p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION 'INVALID_JOB_CLAIM' USING ERRCODE='22023';
 END IF;
 -- Never wait on another claimant while expiring exhausted jobs.
 WITH exhausted AS (SELECT j.id FROM public.job_runs j JOIN public.campaign_memories m ON m.id=j.entity_id AND m.business_id=j.business_id WHERE j.business_id=p_business_id AND j.job_type='embed_memory' AND m.embedding_model=p_model AND m.embedding_profile=p_profile AND m.embedding_version=p_embedding_version
  AND j.attempt_count>=p_max_attempts AND (j.status IN ('queued','retryable_failed') OR (j.status='running' AND j.locked_until<clock_timestamp()))
  FOR UPDATE OF j SKIP LOCKED)
 UPDATE public.job_runs j SET status='dead',locked_until=NULL,finished_at=clock_timestamp(),last_error_code='MAX_ATTEMPTS'
 FROM exhausted x WHERE j.id=x.id;
 RETURN QUERY WITH picked AS (
  SELECT j.id FROM public.job_runs j JOIN public.campaign_memories m ON m.id=j.entity_id AND m.business_id=j.business_id
  WHERE j.business_id=p_business_id AND j.job_type='embed_memory' AND m.review_status='approved'
   AND m.embedding_status IN ('queued','failed','ready') AND m.embedding_model=p_model AND m.embedding_profile=p_profile
   AND m.embedding_version=p_embedding_version AND j.dedupe_key=jsonb_build_array(m.id,m.embedding_version,m.content_hash,p_model,p_profile)::text
   AND j.attempt_count<p_max_attempts AND j.next_run_at<=clock_timestamp() AND
    (j.status IN ('queued','retryable_failed') OR (j.status='running' AND j.locked_until<clock_timestamp()))
  ORDER BY j.next_run_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT p_limit
 ) UPDATE public.job_runs j SET status='running',attempt_count=j.attempt_count+1,
  locked_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),finished_at=NULL
 FROM picked x WHERE j.id=x.id RETURNING j.*;
END $$;

--
-- Name: claim_payment_attempt(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_payment_attempt(p_token_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_order public.orders;
  v_payment public.payments;
begin
  select * into v_order from public.orders as customer_order where customer_order.private_token_hash = p_token_hash for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.order_status <> 'pending_payment' or v_order.payment_due_at is null or v_order.payment_due_at <= now() then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  select * into v_payment from public.payments as payment where payment.order_id = v_order.id and payment.is_active_attempt for update;
  if found then
    if v_payment.qr_content is not null then
      return private.payment_attempt_result(v_payment, 'reuse_qr');
    end if;
    if v_payment.updated_at > now() - interval '60 seconds' then
      return private.payment_attempt_result(v_payment, 'wait');
    end if;
    update public.payments set updated_at = now() where id = v_payment.id returning * into v_payment;
    return private.payment_attempt_result(v_payment, 'reconcile');
  end if;

  insert into public.payments (business_id, order_id, provider_order_id, attempt_number, amount_idr, status, is_active_attempt)
  select v_order.business_id, v_order.id, v_order.public_order_number || '-' || next_attempt.number, next_attempt.number, v_order.total_idr, 'initiating', true
  from (select coalesce(max(payment.attempt_number), 0) + 1 as number from public.payments as payment where payment.order_id = v_order.id) as next_attempt
  returning * into v_payment;

  return private.payment_attempt_result(v_payment, 'create_charge');
end;
$$;

--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    preorder_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    slug character varying(160),
    status text NOT NULL,
    offer_type text NOT NULL,
    marketing_approach text NOT NULL,
    discount_bps integer DEFAULT 0 NOT NULL,
    budget_cap_idr bigint NOT NULL,
    primary_kpi text NOT NULL,
    target_additional_units integer NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    published_at timestamp with time zone,
    closed_at timestamp with time zone,
    completed_at timestamp with time zone,
    active_blueprint_id uuid,
    published_blueprint_id uuid,
    baseline_json jsonb,
    baseline_calculated_at timestamp with time zone,
    metrics_schema_version integer,
    costs_completeness text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaigns_baseline_json_check CHECK ((jsonb_typeof(baseline_json) = 'object'::text)),
    CONSTRAINT campaigns_budget_cap_idr_check CHECK ((budget_cap_idr >= 0)),
    CONSTRAINT campaigns_check CHECK ((starts_at < ends_at)),
    CONSTRAINT campaigns_check1 CHECK ((((offer_type = 'normal_price'::text) AND (discount_bps = 0) AND (marketing_approach <> 'limited_discount'::text)) OR ((offer_type = 'percent_discount'::text) AND ((discount_bps >= 1) AND (discount_bps <= 9999)) AND (marketing_approach = 'limited_discount'::text)))),
    CONSTRAINT campaigns_check2 CHECK (((status <> 'published'::text) OR ((published_at IS NOT NULL) AND (active_blueprint_id IS NOT NULL) AND (published_blueprint_id = active_blueprint_id) AND (baseline_json IS NOT NULL) AND (baseline_calculated_at IS NOT NULL) AND (metrics_schema_version IS NOT NULL) AND (slug IS NOT NULL)))),
    CONSTRAINT campaigns_costs_completeness_check CHECK ((costs_completeness = ANY (ARRAY['unreviewed'::text, 'confirmed_complete'::text]))),
    CONSTRAINT campaigns_discount_bps_check CHECK ((discount_bps >= 0)),
    CONSTRAINT campaigns_marketing_approach_check CHECK ((marketing_approach = ANY (ARRAY['scheduled_reminder'::text, 'value_content'::text, 'limited_discount'::text]))),
    CONSTRAINT campaigns_metrics_schema_version_check CHECK ((metrics_schema_version > 0)),
    CONSTRAINT campaigns_offer_type_check CHECK ((offer_type = ANY (ARRAY['normal_price'::text, 'percent_discount'::text]))),
    CONSTRAINT campaigns_primary_kpi_check CHECK ((primary_kpi = 'paid_units_in_window'::text)),
    CONSTRAINT campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'closed'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT campaigns_target_additional_units_check CHECK ((target_additional_units > 0)),
    CONSTRAINT campaigns_version_check CHECK ((version > 0))
);

--
-- Name: close_campaign(uuid, uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_campaign(p_business_id uuid, p_campaign_id uuid, p_expected_version integer, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS public.campaigns
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE camp public.campaigns;
BEGIN
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 PERFORM private.lock_campaign_context(p_campaign_id);
 SELECT * INTO STRICT camp FROM public.campaigns WHERE id=p_campaign_id AND business_id=p_business_id;
 IF camp.status<>'published' OR camp.version<>p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 UPDATE public.campaigns SET status='closed',closed_at=clock_timestamp() WHERE id=camp.id RETURNING * INTO camp;
 RETURN camp;
END $$;

--
-- Name: close_preorder(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_preorder(p_preorder_id uuid, p_expected_version integer, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_preorder public.preorders := private.lock_owned_preorder(p_preorder_id, p_expected_version);
begin
  if v_preorder.status <> 'published' then
    raise exception 'PREORDER_NOT_PUBLISHED';
  end if;
  if btrim(coalesce(p_reason, '')) = '' or char_length(p_reason) > 500 then
    raise exception 'PREORDER_INPUT_INVALID';
  end if;

  update public.preorders set status = 'closed', closed_at = now() where id = p_preorder_id;

  insert into public.domain_events (business_id, entity_type, entity_id, event_type, actor_type, actor_user_id, safe_details_json, occurred_at)
  values (v_preorder.business_id, 'preorder', p_preorder_id, 'preorder_closed', 'owner', auth.uid(), jsonb_build_object('reason', btrim(p_reason)), now());
end;
$$;

--
-- Name: complete_job(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_job(p_job_id uuid, p_attempt integer, p_provider_reference text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_job public.job_runs;
BEGIN
  SELECT * INTO v_job FROM public.job_runs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_job.job_type = 'embed_memory' THEN
    RAISE EXCEPTION 'ATOMIC_MEMORY_INDEXING_REQUIRED' USING ERRCODE = '23514';
  END IF;
  -- Check the authoritative clock after locking: the lease can expire while waiting for the row.
  IF v_job.status <> 'running' OR v_job.attempt_count IS DISTINCT FROM p_attempt
     OR v_job.locked_until IS NULL OR v_job.locked_until <= clock_timestamp() THEN
    RETURN false;
  END IF;

  UPDATE public.job_runs
  SET status = 'succeeded', finished_at = now(), locked_until = NULL, last_error_code = NULL,
      provider_reference = coalesce(p_provider_reference, provider_reference)
  WHERE id = p_job_id;
  RETURN true;
END $$;

--
-- Name: complete_memory_index_job(uuid, uuid, integer, uuid, text, integer, text, text, extensions.vector, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_memory_index_job(p_business_id uuid, p_job_id uuid, p_attempt_count integer, p_memory_id uuid, p_content_hash text, p_embedding_version integer, p_model text, p_profile text, p_embedding extensions.vector DEFAULT NULL::extensions.vector, p_error_code text DEFAULT NULL::text, p_max_attempts integer DEFAULT 5) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE m public.campaign_memories;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT m FROM public.campaign_memories WHERE id=p_memory_id AND business_id=p_business_id;
 PERFORM private.lock_campaign_context(m.campaign_id);
 PERFORM 1 FROM public.campaign_memories WHERE id=m.id FOR UPDATE;
 IF p_error_code IS NULL THEN PERFORM private.check_memory_source(m.id); END IF;
 PERFORM private.finish_memory_index_job(p_business_id,p_job_id,p_attempt_count,p_memory_id,p_content_hash,
  p_embedding_version,p_model,p_profile,p_embedding,p_error_code,p_max_attempts);
END $$;

--
-- Name: complete_memory_indexing(uuid, text, integer, text, text, extensions.vector); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_memory_indexing(p_memory_id uuid, p_content_hash text, p_embedding_version integer, p_model text, p_profile text, p_embedding extensions.vector) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: complete_preorder(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_preorder(p_preorder_id uuid, p_expected_version integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (private.lock_owned_preorder(p_preorder_id, p_expected_version)).status <> 'closed' then
    raise exception 'PREORDER_NOT_CLOSED';
  end if;

  if exists (
    select 1
    from public.orders as customer_order
    where customer_order.preorder_id = p_preorder_id
      and (
        customer_order.order_status in ('pending_payment', 'awaiting_confirmation', 'requires_review')
        or (customer_order.order_status = 'active' and customer_order.fulfillment_status not in ('fulfilled', 'cancelled'))
      )
  ) then
    raise exception 'PREORDER_ORDERS_UNRESOLVED';
  end if;

  update public.preorders set status = 'completed', completed_at = now() where id = p_preorder_id;
end;
$$;

--
-- Name: campaign_ai_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_ai_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    preorder_id uuid NOT NULL,
    campaign_id uuid,
    status text NOT NULL,
    summary_text text,
    context_version_hash text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_ai_sessions_context_version_hash_check CHECK ((context_version_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT campaign_ai_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text]))),
    CONSTRAINT campaign_ai_sessions_summary_text_check CHECK (((summary_text IS NULL) OR (length(summary_text) <= 12000))),
    CONSTRAINT campaign_ai_sessions_version_check CHECK ((version > 0))
);

--
-- Name: create_ai_session(uuid, uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_ai_session(p_business_id uuid, p_preorder_id uuid, p_session_id uuid, p_context_hash text, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS public.campaign_ai_sessions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: create_business_with_owner(text, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_business_with_owner(p_name text, p_slug text, p_category text, p_pickup_instructions text, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: create_business_with_owner(text, text, text[], text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_business_with_owner(p_name text, p_slug text, p_categories text[], p_description text, p_public_contact text, p_pickup_instructions text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_business_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  insert into public.businesses (name, slug, categories, description, public_contact, pickup_instructions)
  values (p_name, p_slug, p_categories, p_description, p_public_contact, p_pickup_instructions)
  returning id into v_business_id;

  insert into public.business_members (business_id, user_id, role)
  values (v_business_id, v_user_id, 'owner');

  return v_business_id;
end;
$$;

--
-- Name: create_campaign_with_initial_blueprint(uuid, uuid, uuid, uuid, jsonb, jsonb, text, uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_campaign_with_initial_blueprint(p_business_id uuid, p_preorder_id uuid, p_campaign_id uuid, p_blueprint_id uuid, p_draft jsonb, p_blueprint_json jsonb, p_context_hash text, p_source_generation_id uuid, p_expected_source_versions jsonb, p_actor_user_id uuid) RETURNS public.campaign_blueprints
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE item public.preorder_items; cap public.production_capacity; po public.preorders; prod public.products;
 existing public.campaign_blueprints; camp public.campaigns; generation public.ai_generations; result public.campaign_blueprints; k text; facts jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 IF p_draft IS DISTINCT FROM jsonb_build_object('name',p_blueprint_json->>'campaignTitle','slug','campaign-'||p_campaign_id::text,
  'offerType',p_blueprint_json#>>'{offer,type}','marketingApproach',p_blueprint_json->>'marketingApproach',
  'discountBps',p_blueprint_json#>'{offer,discountBps}','budgetCapIdr',p_blueprint_json->'budgetCapIdr',
  'targetAdditionalUnits',p_blueprint_json->'targetAdditionalUnits','startsAt',p_blueprint_json#>>'{executionWindow,startsAt}',
  'endsAt',p_blueprint_json#>>'{executionWindow,endsAt}') OR p_expected_source_versions IS DISTINCT FROM p_blueprint_json->'sourceVersions' THEN
  RAISE EXCEPTION 'DRAFT_BLUEPRINT_MISMATCH' USING ERRCODE='23514'; END IF;
 -- One serialization key for the command, before checking whether an earlier attempt committed.
 PERFORM pg_advisory_xact_lock(hashtextextended('create-campaign:'||p_campaign_id::text,0));
 SELECT * INTO existing FROM public.campaign_blueprints WHERE id=p_blueprint_id;
 IF FOUND THEN
  IF existing.business_id IS DISTINCT FROM p_business_id OR existing.campaign_id IS DISTINCT FROM p_campaign_id OR
   existing.source_ai_generation_id IS DISTINCT FROM p_source_generation_id OR existing.blueprint_json IS DISTINCT FROM p_blueprint_json OR
   existing.context_hash IS DISTINCT FROM p_context_hash OR existing.blueprint_json->>'preorderId' IS DISTINCT FROM p_preorder_id::text THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001'; END IF;
  RETURN existing;
 END IF;
 IF EXISTS(SELECT 1 FROM public.campaigns WHERE id=p_campaign_id) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT item FROM public.preorder_items WHERE preorder_id=p_preorder_id AND business_id=p_business_id;
 SELECT * INTO STRICT cap FROM public.production_capacity WHERE id=item.capacity_id FOR UPDATE;
 SELECT * INTO STRICT po FROM public.preorders WHERE id=p_preorder_id AND business_id=p_business_id FOR UPDATE;
 SELECT * INTO STRICT item FROM public.preorder_items WHERE id=item.id FOR UPDATE;
 SELECT * INTO STRICT prod FROM public.products WHERE id=item.product_id FOR UPDATE;
 facts:=jsonb_build_object('capacityVersion',cap.version,'preorderVersion',po.version,'preorderItemVersion',item.version,'productVersion',prod.version);
 FOREACH k IN ARRAY ARRAY['capacityVersion','preorderVersion','preorderItemVersion','productVersion'] LOOP
  IF facts->>k IS DISTINCT FROM p_expected_source_versions->>k THEN RAISE EXCEPTION 'STALE_FACT_VERSIONS' USING ERRCODE='40001'; END IF;
 END LOOP;
 IF po.status<>'published' OR po.ends_at<=clock_timestamp() THEN RAISE EXCEPTION 'PREORDER_NOT_PUBLISHABLE' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT generation FROM public.ai_generations WHERE id=p_source_generation_id AND business_id=p_business_id AND preorder_id=p_preorder_id;
 IF generation.status<>'success' OR generation.session_id IS NULL OR generation.campaign_id IS NOT NULL OR
  p_blueprint_json->>'businessId' IS DISTINCT FROM p_business_id::text OR p_blueprint_json->>'campaignId' IS DISTINCT FROM p_campaign_id::text OR
  p_blueprint_json->>'preorderId' IS DISTINCT FROM p_preorder_id::text OR p_blueprint_json->>'contextHash' IS DISTINCT FROM p_context_hash OR
  p_blueprint_json#>>'{source,generationId}' IS DISTINCT FROM generation.id::text OR
  p_blueprint_json#>>'{source,sessionId}' IS DISTINCT FROM generation.session_id::text OR
  p_blueprint_json#>>'{source,proposalVersion}' IS DISTINCT FROM generation.output_json->>'proposalVersion' OR
  generation.output_json->>'contextHash' IS DISTINCT FROM p_context_hash OR generation.output_json->>'persistence' IS DISTINCT FROM 'saved' OR
  p_blueprint_json->>'blueprintVersion' IS DISTINCT FROM '1' OR p_blueprint_json->>'schemaVersion' IS DISTINCT FROM '1' OR
  p_blueprint_json#>>'{revision,requestId}' IS DISTINCT FROM p_blueprint_id::text OR
  p_blueprint_json#>>'{revision,parentBlueprintId}' IS NOT NULL OR p_blueprint_json#>>'{revision,parentVersion}' IS NOT NULL OR
  coalesce(p_blueprint_json#>>'{revision,requestHash}','') !~ '^[a-f0-9]{64}$' OR
  NOT EXISTS(SELECT 1 FROM public.campaign_ai_messages m WHERE m.ai_generation_id=generation.id AND m.role='assistant'
   AND m.business_id=p_business_id AND m.session_id=generation.session_id AND m.id::text=p_blueprint_json#>>'{source,messageId}'
   AND m.proposal_json=generation.output_json) OR
  NOT EXISTS(SELECT 1 FROM jsonb_array_elements(generation.output_json->'options') o WHERE o->>'proposalKey'=p_blueprint_json#>>'{source,proposalKey}') THEN
  RAISE EXCEPTION 'GENERATION_SOURCE_MISMATCH' USING ERRCODE='23514'; END IF;
 -- Existing RPCs run under this same PostgreSQL transaction; any failure rolls everything back.
 camp:=public.save_campaign_draft(p_business_id,p_campaign_id,p_preorder_id,NULL,p_draft,p_actor_user_id);
 -- Validate the child plan before storing it; any child failure also rolls the new parent back.
 IF jsonb_typeof(p_blueprint_json->'tasks') IS DISTINCT FROM 'array' OR jsonb_typeof(p_blueprint_json->'contents') IS DISTINCT FROM 'array' OR
  jsonb_array_length(p_blueprint_json->'tasks') NOT BETWEEN 1 AND 12 OR jsonb_array_length(p_blueprint_json->'contents') NOT BETWEEN 1 AND 8 THEN
  RAISE EXCEPTION 'BLUEPRINT_CONTENT_BOUNDS' USING ERRCODE='23514'; END IF;
 result:=public.save_blueprint_revision(p_business_id,p_campaign_id,camp.version,p_blueprint_id,p_context_hash,p_blueprint_json,p_source_generation_id,p_actor_user_id);
 RETURN result;
END $_$;

--
-- Name: create_manual_order(uuid, integer, text, text, text, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_manual_order(p_preorder_id uuid, p_quantity integer, p_customer_name text, p_customer_email text, p_customer_contact text, p_is_paid boolean, p_idempotency_key text, p_request_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_preorder public.preorders;
  v_item public.preorder_items;
  v_capacity public.production_capacity;
  v_existing public.orders;
  v_order public.orders;
begin
  if p_quantity is null or p_quantity not between 1 and 10000
     or btrim(coalesce(p_customer_name, '')) = '' or char_length(p_customer_name) > 160
     or char_length(coalesce(p_customer_email, '')) > 254
     or char_length(coalesce(p_customer_contact, '')) > 120
     or p_is_paid is null
     or coalesce(p_idempotency_key, '') = '' or coalesce(p_request_hash, '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_preorder
  from public.preorders as preorder
  where preorder.id = p_preorder_id and preorder.business_id = private.current_owner_business()
  for share;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  select * into v_item from public.preorder_items as item where item.preorder_id = v_preorder.id;
  select * into v_capacity from public.production_capacity as capacity where capacity.id = v_item.capacity_id for update;

  select * into v_existing
  from public.orders as customer_order
  where customer_order.business_id = v_preorder.business_id and customer_order.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return private.order_result(v_existing, true);
  end if;

  if v_preorder.status <> 'published' or now() >= v_capacity.fulfillment_window_end_at then
    raise exception 'PREORDER_NOT_OPEN';
  end if;

  perform private.assert_orderable(v_capacity, v_item, p_quantity);

  v_order := private.insert_order(
    v_preorder, v_item, 'manual', 'external_manual', case when p_is_paid then 'confirmed' else 'unpaid' end, 'awaiting_confirmation',
    btrim(p_customer_name), nullif(lower(btrim(coalesce(p_customer_email, ''))), ''), nullif(btrim(coalesce(p_customer_contact, '')), ''), p_quantity,
    null, p_idempotency_key, p_request_hash, 'allocated', null,
    0, null, null
  );
  return private.order_result(v_order, false);
end;
$$;

--
-- Name: create_preorder_order(text, integer, text, text, text, text, text, text, bigint, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_preorder_order(p_slug text, p_quantity integer, p_customer_name text, p_customer_email text, p_customer_contact text, p_token_hash text, p_idempotency_key text, p_request_hash text, p_expected_unit_price_idr bigint, p_hold_ttl_seconds integer, p_attribution_ref text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_preorder public.preorders;
  v_item public.preorder_items;
  v_capacity public.production_capacity;
  v_existing public.orders;
  v_order public.orders;
  v_discount_bps integer;
  v_pricing_campaign_id uuid;
begin
  if p_quantity is null or p_quantity not between 1 and 10000
     or btrim(coalesce(p_customer_name, '')) = '' or char_length(p_customer_name) > 160
     or coalesce(btrim(p_customer_email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(btrim(p_customer_email)) > 254
     or char_length(coalesce(p_customer_contact, '')) > 120
     or coalesce(p_token_hash, '') = '' or coalesce(p_idempotency_key, '') = '' or coalesce(p_request_hash, '') = ''
     or p_expected_unit_price_idr is null
     or p_hold_ttl_seconds is null or p_hold_ttl_seconds <= 0
     or char_length(coalesce(p_attribution_ref, '')) > 200 then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_preorder from public.preorders as preorder where preorder.slug = p_slug for share;
  if not found then
    raise exception 'PREORDER_NOT_OPEN';
  end if;

  select * into v_item from public.preorder_items as item where item.preorder_id = v_preorder.id;
  select * into v_capacity from public.production_capacity as capacity where capacity.id = v_item.capacity_id for update;

  -- Dicek sebelum status preorder: respons yang hilang harus bisa diambil ulang walau preorder sudah ditutup.
  select * into v_existing
  from public.orders as customer_order
  where customer_order.business_id = v_preorder.business_id and customer_order.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from p_request_hash or v_existing.private_token_hash is distinct from p_token_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return private.order_result(v_existing, true);
  end if;

  if v_preorder.status <> 'published'
     or now() < v_preorder.starts_at
     or now() >= v_preorder.ends_at
     or now() >= v_capacity.intake_cutoff_at then
    raise exception 'PREORDER_NOT_OPEN';
  end if;

  -- Kunci kampanye terbit sebelum membaca offer: tutup kampanye menunggu pesanan ini selesai, atau pesanan melihat
  -- kampanye yang sudah ditutup. Dikunci terakhir (setelah preorder dan kapasitas) agar tidak menambah siklus kunci.
  perform 1 from public.campaigns as campaign
  where campaign.preorder_id = v_preorder.id and campaign.status = 'published'
  for share;

  select offer.discount_bps, offer.pricing_campaign_id into v_discount_bps, v_pricing_campaign_id
  from private.current_order_offer(v_preorder.id) as offer;

  if p_expected_unit_price_idr <> v_item.base_price_snapshot_idr - private.discount_per_unit(v_item.base_price_snapshot_idr, v_discount_bps) then
    raise exception 'OFFER_CHANGED';
  end if;

  perform private.assert_orderable(v_capacity, v_item, p_quantity);

  begin
    v_order := private.insert_order(
      v_preorder, v_item, 'public', 'midtrans_sandbox', null, 'pending_payment',
      btrim(p_customer_name), lower(btrim(p_customer_email)), nullif(btrim(coalesce(p_customer_contact, '')), ''), p_quantity,
      p_token_hash, p_idempotency_key, p_request_hash, 'held', now() + make_interval(secs => p_hold_ttl_seconds),
      v_discount_bps, v_pricing_campaign_id, private.resolve_attribution(v_preorder.id, p_attribution_ref)
    );
  exception
    when unique_violation then
      raise exception 'IDEMPOTENCY_CONFLICT';
  end;

  return private.order_result(v_order, false);
end;
$_$;

--
-- Name: create_standalone_manual_order(uuid, integer, text, text, text, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_standalone_manual_order(p_capacity_id uuid, p_quantity integer, p_customer_name text, p_customer_email text, p_customer_contact text, p_is_paid boolean, p_idempotency_key text, p_request_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_business_id uuid := private.current_owner_business();
  v_capacity public.production_capacity;
  v_product public.products;
  v_existing public.orders;
  v_order public.orders;
  v_preorder public.preorders;
  v_item public.preorder_items;
begin
  if p_quantity is null or p_quantity not between 1 and 10000
     or btrim(coalesce(p_customer_name, '')) = '' or char_length(p_customer_name) > 160
     or char_length(coalesce(p_customer_email, '')) > 254
     or char_length(coalesce(p_customer_contact, '')) > 120
     or p_is_paid is null
     or coalesce(p_idempotency_key, '') = '' or coalesce(p_request_hash, '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_capacity
  from public.production_capacity as capacity
  where capacity.id = p_capacity_id and capacity.business_id = v_business_id
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  select * into v_existing
  from public.orders as customer_order
  where customer_order.business_id = v_business_id and customer_order.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return private.order_result(v_existing, true);
  end if;

  if now() >= v_capacity.fulfillment_window_end_at then
    raise exception 'SCHEDULE_CLOSED';
  end if;

  select * into v_product from public.products as product where product.id = v_capacity.product_id;
  if not v_product.is_active then
    raise exception 'PRODUCT_INACTIVE';
  end if;

  if p_quantity > v_capacity.total_units - private.committed_units(v_capacity.id, null) then
    raise exception 'CAPACITY_UNAVAILABLE';
  end if;

  -- `insert_order` hanya membaca field ini. Id preorder dan itemnya kosong, karena pesanan ini memang tidak terkait preorder.
  v_preorder.business_id := v_business_id;
  v_preorder.fulfillment_date := v_capacity.fulfillment_date;
  v_item.product_id := v_product.id;
  v_item.capacity_id := v_capacity.id;
  v_item.base_price_snapshot_idr := v_product.base_price_idr;
  v_item.product_name_snapshot := v_product.name;
  v_item.sku_snapshot := v_product.sku;

  v_order := private.insert_order(
    v_preorder, v_item, 'manual', 'external_manual', case when p_is_paid then 'confirmed' else 'unpaid' end, 'awaiting_confirmation',
    btrim(p_customer_name), nullif(lower(btrim(coalesce(p_customer_email, ''))), ''), nullif(btrim(coalesce(p_customer_contact, '')), ''), p_quantity,
    null, p_idempotency_key, p_request_hash, 'allocated', null,
    0, null, null
  );
  return private.order_result(v_order, false);
end;
$$;

--
-- Name: decline_late_payment(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decline_late_payment(p_order_id uuid, p_expected_version integer, p_note text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_order public.orders := private.lock_order(p_order_id, p_expected_version, private.current_owner_business());
  v_next_status text := case when v_order.cancelled_at is not null then 'cancelled' else 'expired' end;
begin
  if btrim(coalesce(p_note, '')) = '' or char_length(p_note) > 500 then
    raise exception 'VALIDATION_ERROR';
  end if;
  if v_order.order_status <> 'requires_review' then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  update public.orders set order_status = v_next_status, review_reason = btrim(p_note) where id = p_order_id;
  perform private.record_order_event(v_order.business_id, p_order_id, 'late_payment_declined', 'requires_review', v_next_status, null);
end;
$$;

--
-- Name: enqueue_expire_jobs(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_expire_jobs(p_limit integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_count integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'VALIDATION_ERROR';
  end if;

  insert into public.job_runs (job_type, entity_id, business_id, dedupe_key)
  select 'expire', customer_order.id, customer_order.business_id, 'expire:' || customer_order.id
  from public.orders as customer_order
  where customer_order.order_status = 'pending_payment' and customer_order.payment_due_at <= now()
  order by customer_order.payment_due_at
  limit p_limit
  on conflict (job_type, dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

--
-- Name: expire_or_cancel_order(uuid, integer, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_or_cancel_order(p_order_id uuid, p_expected_version integer, p_action text, p_reason text, p_refund_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_business_id uuid := case when auth.uid() is null then null else private.current_owner_business() end;
  v_order public.orders := private.lock_order(p_order_id, p_expected_version, v_business_id);
  v_before_production boolean := v_order.fulfillment_status in ('pending_confirmation', 'confirmed');
  v_is_paid boolean;
begin
  if p_action = 'expire' then
    if v_order.order_status = 'expired' then
      return;
    end if;
    if v_order.order_status <> 'pending_payment' or v_order.payment_due_at is null or v_order.payment_due_at > now() then
      raise exception 'ORDER_STATE_INVALID';
    end if;
    update public.orders set order_status = 'expired', fulfillment_status = 'cancelled' where id = p_order_id;
    update public.capacity_reservations
    set state = 'released', released_at = now(), release_reason = 'expired'
    where order_id = p_order_id and state = 'held';
    perform private.close_active_payment_attempts(v_order, 'expired');
    perform private.record_order_event(v_order.business_id, p_order_id, 'order_expired', 'pending_payment', 'expired', null);
    return;
  end if;

  if p_action <> 'cancel' or v_business_id is null or btrim(coalesce(p_reason, '')) = '' or char_length(p_reason) > 500
     or char_length(coalesce(p_refund_note, '')) > 500 then
    raise exception 'VALIDATION_ERROR';
  end if;
  if v_order.order_status in ('expired', 'cancelled') or v_order.fulfillment_status in ('fulfilled', 'cancelled') then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  v_is_paid := v_order.external_payment_status = 'confirmed'
    or exists (select 1 from public.payments as payment where payment.order_id = p_order_id and payment.applied_at is not null);
  if v_is_paid and btrim(coalesce(p_refund_note, '')) = '' then
    raise exception 'REFUND_NOTE_REQUIRED';
  end if;

  update public.orders
  set order_status = 'cancelled',
      fulfillment_status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = btrim(p_reason),
      review_reason = case when v_is_paid then btrim(p_refund_note) else review_reason end,
      external_payment_status = case when external_payment_status = 'unpaid' then 'voided' else external_payment_status end
  where id = p_order_id;

  if v_before_production then
    update public.capacity_reservations
    set state = 'released', released_at = now(), release_reason = 'cancelled'
    where order_id = p_order_id and state in ('held', 'allocated');
  end if;

  perform private.close_active_payment_attempts(v_order, 'cancelled');
  perform private.record_order_event(
    v_order.business_id, p_order_id, 'order_cancelled', v_order.order_status, 'cancelled',
    jsonb_build_object('slot_released', v_before_production, 'refund_note_recorded', v_is_paid)
  );
end;
$$;

--
-- Name: fail_ai_generation(uuid, uuid, uuid, integer, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_ai_generation(p_business_id uuid, p_session_id uuid, p_generation_id uuid, p_claim_version integer, p_error_code text, p_actor_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
END $_$;

--
-- Name: fail_job(uuid, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_job(p_job_id uuid, p_attempt integer, p_error_code text, p_provider_reference text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_job public.job_runs;
  v_max_attempts constant integer := 5;
  v_status text;
BEGIN
  IF coalesce(p_error_code, '') !~ '^[A-Z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  SELECT * INTO v_job FROM public.job_runs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_job.job_type = 'embed_memory' THEN
    RAISE EXCEPTION 'ATOMIC_MEMORY_INDEXING_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF v_job.status <> 'running' OR v_job.attempt_count IS DISTINCT FROM p_attempt
     OR v_job.locked_until IS NULL OR v_job.locked_until <= clock_timestamp() THEN
    RETURN NULL;
  END IF;

  UPDATE public.job_runs
  SET status = CASE WHEN attempt_count >= v_max_attempts THEN 'dead' ELSE 'retryable_failed' END,
      finished_at = CASE WHEN attempt_count >= v_max_attempts THEN now() END,
      next_run_at = CASE WHEN attempt_count >= v_max_attempts THEN next_run_at ELSE now() + private.job_backoff(attempt_count) END,
      locked_until = NULL,
      last_error_code = p_error_code,
      provider_reference = coalesce(p_provider_reference, provider_reference)
  WHERE id = p_job_id
  RETURNING status INTO v_status;
  RETURN v_status;
END $_$;

--
-- Name: finalize_ai_generation(uuid, uuid, uuid, integer, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_ai_generation(p_business_id uuid, p_session_id uuid, p_generation_id uuid, p_claim_version integer, p_output_json jsonb, p_actor_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: finalize_campaign_evaluation(uuid, uuid, uuid, uuid, uuid, integer, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_campaign_evaluation(p_business_id uuid, p_campaign_id uuid, p_preorder_id uuid, p_evaluation_id uuid, p_request_id uuid, p_expected_campaign_version integer, p_expected_context_hash text, p_mode text, p_actor_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE c public.campaigns; e public.campaign_evaluations; prior public.campaign_evaluations; last_id uuid;
 completed timestamptz; audit jsonb; analytics jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 PERFORM private.lock_campaign_context(p_campaign_id);
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=p_campaign_id AND business_id=p_business_id AND preorder_id=p_preorder_id;
 SELECT * INTO prior FROM public.campaign_evaluations WHERE id=p_request_id;
 IF FOUND THEN
  audit:=prior.metrics_json->'finalization';
  IF prior.campaign_id IS DISTINCT FROM c.id OR prior.business_id IS DISTINCT FROM p_business_id OR
    audit->>'reviewedEvaluationId' IS DISTINCT FROM p_evaluation_id::text OR audit->>'mode' IS DISTINCT FROM p_mode OR
    (audit->>'expectedCampaignVersion')::integer IS DISTINCT FROM p_expected_campaign_version OR
    audit->>'sourceContextHash' IS DISTINCT FROM p_expected_context_hash OR audit->>'actorUserId' IS DISTINCT FROM p_actor_user_id::text OR
    c.status<>'completed' OR c.completed_at IS DISTINCT FROM (audit->>'completedAt')::timestamptz THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001';
  END IF;
  RETURN prior.id;
 END IF;
 IF c.status<>'closed' THEN RAISE EXCEPTION 'CLOSED_CAMPAIGN_REQUIRED' USING ERRCODE='23514'; END IF;
 IF c.version<>p_expected_campaign_version THEN RAISE EXCEPTION 'STALE_SOURCE_STATE' USING ERRCODE='40001'; END IF;
 SELECT * INTO e FROM public.campaign_evaluations WHERE id=p_evaluation_id AND campaign_id=c.id AND business_id=p_business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVALUATION_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT id INTO last_id FROM public.campaign_evaluations WHERE campaign_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF last_id IS DISTINCT FROM e.id THEN RAISE EXCEPTION 'STALE_EVALUATION_VERSION' USING ERRCODE='40001'; END IF;
 IF e.analysis_json#>>'{review,status}' IS DISTINCT FROM 'reviewed' OR
    e.analysis_json#>>'{review,reviewedByUserId}' IS DISTINCT FROM p_actor_user_id::text OR NOT (e.metrics_json ? 'cas') THEN
  RAISE EXCEPTION 'OWNER_REVIEW_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF e.blueprint_id IS DISTINCT FROM c.published_blueprint_id OR c.baseline_json IS NULL OR c.closed_at IS NULL OR c.published_at IS NULL THEN
  RAISE EXCEPTION 'INVALID_EVALUATION' USING ERRCODE='23514';
 END IF;
 IF e.metrics_json#>>'{context,contextHash}' IS DISTINCT FROM p_expected_context_hash THEN RAISE EXCEPTION 'STALE_SOURCE_STATE' USING ERRCODE='40001'; END IF;
 PERFORM private.check_evaluation_sources(c.id,e.metrics_json->'context');
 IF c.costs_completeness<>'confirmed_complete' THEN RAISE EXCEPTION 'COSTS_INCOMPLETE' USING ERRCODE='23514'; END IF;
 analytics:=e.metrics_json#>'{context,analytics,data}';
 IF e.metrics_json#>>'{context,analytics,status}' IS DISTINCT FROM 'available' OR
    analytics->>'costsComplete' IS DISTINCT FROM 'true' OR analytics->>'operationallyResolved' IS DISTINCT FROM 'true' OR
    analytics#>>'{metrics,paidUnitsInWindow}' IS NULL OR analytics#>>'{metrics,scopedFulfilledSalesValueIdr}' IS NULL OR
    analytics#>>'{metrics,scopedProductionCostIncurredIdr}' IS NULL THEN
  RAISE EXCEPTION 'KPI_INCOMPLETE' USING ERRCODE='23514';
 END IF;
 -- No production C6 revision authority exists yet. A trusted development server may finish only an empty real cohort.
 IF p_mode IS DISTINCT FROM 'development_synthetic' OR analytics->>'provenance' IS DISTINCT FROM 'development_fixture' OR
    analytics->>'isProvisional' IS DISTINCT FROM 'true' OR analytics->'financialScopeOrderIds' IS DISTINCT FROM 'null'::jsonb OR
    e.analysis_json->>'synthetic' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'VERIFIED_C6_UNAVAILABLE' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE preorder_id=c.preorder_id) OR
    EXISTS(SELECT 1 FROM public.capacity_reservations r JOIN public.preorder_items i ON i.id=r.preorder_item_id WHERE i.preorder_id=c.preorder_id) THEN
  RAISE EXCEPTION 'SYNTHETIC_COHORT_REQUIRED' USING ERRCODE='23514';
 END IF;
 completed:=clock_timestamp();
 audit:=jsonb_build_object('mode',p_mode,'requestId',p_request_id,'reviewedEvaluationId',e.id,
  'expectedCampaignVersion',c.version,'completedCampaignVersion',c.version+1,'completedAt',completed,
  'actorUserId',p_actor_user_id,'sourceContextHash',p_expected_context_hash);
 INSERT INTO public.campaign_evaluations(id,business_id,campaign_id,blueprint_id,metrics_schema_version,metrics_json,
  analysis_json,limitations_json,evaluation_kind,calculated_at,evaluated_at)
 VALUES(p_request_id,p_business_id,c.id,e.blueprint_id,1,
  e.metrics_json||jsonb_build_object('parentEvaluationId',e.id,'cas',jsonb_build_object('expectedEvaluationId',e.id),'finalization',audit),
  e.analysis_json,e.limitations_json,'final',e.calculated_at,completed);
 UPDATE public.campaigns SET status='completed',completed_at=completed WHERE id=c.id;
 RETURN p_request_id;
END $$;

--
-- Name: finish_job(uuid, integer, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_job(p_job_id uuid, p_attempt_count integer, p_success boolean, p_error_code text DEFAULT NULL::text, p_provider_reference text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.job_runs WHERE id=p_job_id AND job_type='embed_memory') THEN
  RAISE EXCEPTION 'ATOMIC_MEMORY_INDEXING_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF p_error_code IS NOT NULL AND p_error_code !~ '^[A-Z_]{1,64}$' THEN RAISE EXCEPTION 'SAFE_ERROR_CODE_REQUIRED' USING ERRCODE='22023'; END IF;
 IF p_success AND EXISTS(SELECT 1 FROM public.job_runs WHERE id=p_job_id AND status='succeeded' AND attempt_count=p_attempt_count
  AND provider_reference IS NOT DISTINCT FROM p_provider_reference) THEN RETURN; END IF;
 UPDATE public.job_runs SET status=CASE WHEN p_success THEN 'succeeded' ELSE 'retryable_failed' END,
  finished_at=CASE WHEN p_success THEN clock_timestamp() ELSE NULL END,locked_until=NULL,last_error_code=p_error_code,
  provider_reference=p_provider_reference,next_run_at=clock_timestamp()+interval '30 seconds'
 WHERE id=p_job_id AND status='running' AND attempt_count=p_attempt_count AND locked_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'STALE_JOB_LEASE' USING ERRCODE='40001'; END IF;
END $_$;

--
-- Name: is_business_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_business_owner(target_business_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 SELECT EXISTS (SELECT 1 FROM public.business_members m
 WHERE m.business_id=target_business_id AND m.user_id=auth.uid() AND m.role='owner');
$$;

--
-- Name: match_campaign_memories(uuid, extensions.vector, text, text, integer, integer, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_campaign_memories(p_business_id uuid, p_embedding extensions.vector, p_model text, p_profile text, p_embedding_version integer, p_limit integer DEFAULT 5, p_min_similarity double precision DEFAULT 0.5) RETURNS TABLE(memory_id uuid, campaign_id uuid, source_evaluation_id uuid, summary_text text, lessons_json jsonb, limitations_json jsonb, similarity double precision)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
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

--
-- Name: publish_campaign(uuid, uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_campaign(p_business_id uuid, p_campaign_id uuid, p_expected_versions jsonb, p_actor_user_id uuid) RETURNS public.campaigns
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: publish_preorder(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_preorder(p_preorder_id uuid, p_expected_version integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM private.publish_preorder_canonical(private.current_owner_business(),p_preorder_id,p_expected_version);
END $$;

--
-- Name: publish_preorder(uuid, uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_preorder(p_business_id uuid, p_preorder_id uuid, p_expected_version integer, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS public.preorders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 RETURN private.publish_preorder_canonical(p_business_id,p_preorder_id,p_expected_version);
END $$;

--
-- Name: read_preorder_offer(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_preorder_offer(p_preorder_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'discount_bps', offer.discount_bps,
    'pricing_campaign_id', offer.pricing_campaign_id,
    'final_unit_price_idr', item.base_price_snapshot_idr - private.discount_per_unit(item.base_price_snapshot_idr, offer.discount_bps)
  )
  from public.preorder_items as item
  cross join lateral private.current_order_offer(item.preorder_id) as offer
  where item.preorder_id = p_preorder_id;
$$;

--
-- Name: record_campaign_evaluation(uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_campaign_evaluation(p_business_id uuid, p_campaign_id uuid, p_blueprint_id uuid, p_evaluation_id uuid, p_kind text, p_metrics jsonb, p_analysis jsonb, p_limitations jsonb, p_calculated_at timestamp with time zone, p_actor_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: record_campaign_evaluation_cas(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_campaign_evaluation_cas(p_business_id uuid, p_campaign_id uuid, p_blueprint_id uuid, p_evaluation_id uuid, p_expected_evaluation_id uuid, p_metrics jsonb, p_analysis jsonb, p_limitations jsonb, p_calculated_at timestamp with time zone, p_actor_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE c public.campaigns; prior public.campaign_evaluations; latest public.campaign_evaluations; m jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM private.require_owner(p_business_id,p_actor_user_id);
 PERFORM private.lock_campaign_context(p_campaign_id);
 SELECT * INTO STRICT c FROM public.campaigns WHERE id=p_campaign_id AND business_id=p_business_id;
 SELECT * INTO prior FROM public.campaign_evaluations WHERE id=p_evaluation_id;
 IF FOUND THEN
  IF (prior.business_id,prior.campaign_id,prior.blueprint_id,prior.metrics_json->>'commandHash',prior.metrics_json#>>'{cas,expectedEvaluationId}') IS DISTINCT FROM
     (p_business_id,p_campaign_id,p_blueprint_id,p_metrics->>'commandHash',p_expected_evaluation_id::text) THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001';
  END IF;
  RETURN prior.id;
 END IF;
 IF c.status<>'closed' THEN RAISE EXCEPTION 'CLOSED_CAMPAIGN_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT * INTO latest FROM public.campaign_evaluations WHERE campaign_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF latest.id IS DISTINCT FROM p_expected_evaluation_id THEN RAISE EXCEPTION 'STALE_EVALUATION_VERSION' USING ERRCODE='40001'; END IF;
 PERFORM private.check_evaluation_sources(c.id,p_metrics->'context');
 IF p_blueprint_id IS DISTINCT FROM c.published_blueprint_id OR p_metrics->>'commandHash' IS NULL OR p_metrics ? 'finalization' THEN
  RAISE EXCEPTION 'INVALID_EVALUATION' USING ERRCODE='23514';
 END IF;
 IF p_analysis#>>'{review,status}'='reviewed' THEN
  IF latest.id IS NULL OR (p_metrics->>'parentEvaluationId')::uuid IS DISTINCT FROM latest.id OR
     p_metrics->'context' IS DISTINCT FROM latest.metrics_json->'context' OR
     p_metrics->'summary' IS DISTINCT FROM latest.metrics_json->'summary' OR
     (p_analysis-'review') IS DISTINCT FROM (latest.analysis_json-'review') OR
     p_analysis#>>'{review,reviewedByUserId}' IS DISTINCT FROM p_actor_user_id::text OR
     latest.analysis_json->>'status' IS DISTINCT FROM 'available' OR
     latest.analysis_json#>>'{review,status}' IS DISTINCT FROM 'unreviewed' THEN
   RAISE EXCEPTION 'INVALID_EVALUATION_REVIEW' USING ERRCODE='23514';
  END IF;
 END IF;
 m:=p_metrics||jsonb_build_object('cas',jsonb_build_object('expectedEvaluationId',p_expected_evaluation_id));
 INSERT INTO public.campaign_evaluations(id,business_id,campaign_id,blueprint_id,metrics_schema_version,
  metrics_json,analysis_json,limitations_json,evaluation_kind,calculated_at,evaluated_at)
 VALUES(p_evaluation_id,p_business_id,p_campaign_id,p_blueprint_id,1,m,p_analysis,p_limitations,'provisional',p_calculated_at,clock_timestamp());
 RETURN p_evaluation_id;
END $$;

--
-- Name: record_payment_charge(uuid, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_payment_charge(p_payment_id uuid, p_provider_transaction_id text, p_qr_content text, p_qr_expires_at timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update public.payments
  set status = 'pending',
      provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id),
      qr_content = p_qr_content,
      qr_expires_at = p_qr_expires_at
  where id = p_payment_id and is_active_attempt and status in ('initiating', 'pending');
  return found;
end;
$$;

--
-- Name: refresh_ai_session_context(uuid, uuid, integer, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_ai_session_context(p_business_id uuid, p_session_id uuid, p_expected_version integer, p_context_hash text, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS public.campaign_ai_sessions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: resolve_production_cost(uuid, integer, bigint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_production_cost(p_order_id uuid, p_expected_version integer, p_cost_per_unit_idr bigint, p_quality text, p_note text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_order public.orders := private.lock_order(p_order_id, p_expected_version, private.current_owner_business());
  v_cost public.order_production_costs;
begin
  if p_cost_per_unit_idr is null or p_cost_per_unit_idr < 0 or p_cost_per_unit_idr > 1000000000
     or p_quality not in ('estimated', 'verified')
     or btrim(coalesce(p_note, '')) = '' or char_length(p_note) > 500 then
    raise exception 'VALIDATION_ERROR';
  end if;

  select cost.* into v_cost
  from public.order_production_costs as cost
  join public.order_items as item on item.id = cost.order_item_id
  where item.order_id = p_order_id
  for update of cost;

  if not found or v_cost.quality <> 'unknown' then
    raise exception 'ORDER_STATE_INVALID';
  end if;

  update public.order_production_costs
  set cost_per_unit_idr = p_cost_per_unit_idr,
      amount_idr = v_cost.quantity * p_cost_per_unit_idr,
      quality = p_quality,
      resolved_by_user_id = auth.uid(),
      resolution_note = btrim(p_note)
  where id = v_cost.id;

  perform private.record_order_event(v_order.business_id, p_order_id, 'production_cost_resolved', 'unknown', p_quality, null);
end;
$$;

--
-- Name: save_blueprint_revision(uuid, uuid, integer, uuid, text, jsonb, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_blueprint_revision(p_business_id uuid, p_campaign_id uuid, p_expected_campaign_version integer, p_blueprint_id uuid, p_context_hash text, p_blueprint_json jsonb, p_source_generation_id uuid, p_actor_user_id uuid) RETURNS public.campaign_blueprints
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: save_campaign_draft(uuid, uuid, uuid, integer, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_campaign_draft(p_business_id uuid, p_campaign_id uuid, p_preorder_id uuid, p_expected_version integer, p_draft jsonb, p_actor_user_id uuid) RETURNS public.campaigns
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: save_preorder_draft(uuid, integer, text, text, uuid, integer, integer, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_preorder_draft(p_preorder_id uuid, p_expected_version integer, p_slug text, p_name text, p_capacity_id uuid, p_target_units integer, p_quota_units integer, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_business_id uuid := private.current_owner_business();
  v_preorder_id uuid := p_preorder_id;
  v_capacity public.production_capacity;
  v_product public.products;
begin
  if btrim(coalesce(p_name, '')) = ''
     or p_target_units is null or p_target_units <= 0
     or p_quota_units is null or p_quota_units < p_target_units then
    raise exception 'PREORDER_INPUT_INVALID';
  end if;

  select * into v_capacity
  from public.production_capacity as capacity
  where capacity.id = p_capacity_id and capacity.business_id = v_business_id;
  if not found then
    raise exception 'PREORDER_CAPACITY_NOT_FOUND';
  end if;

  select * into v_product
  from public.products as product
  where product.id = v_capacity.product_id and product.business_id = v_business_id;
  if not v_product.is_active then
    raise exception 'PREORDER_PRODUCT_INACTIVE';
  end if;

  if p_starts_at >= p_ends_at or p_ends_at > v_capacity.intake_cutoff_at then
    raise exception 'PREORDER_SCHEDULE_INVALID';
  end if;

  if v_preorder_id is null then
    insert into public.preorders (business_id, name, slug, fulfillment_date, starts_at, ends_at)
    values (v_business_id, p_name, p_slug, v_capacity.fulfillment_date, p_starts_at, p_ends_at)
    returning id into v_preorder_id;

    insert into public.preorder_items (
      business_id, preorder_id, product_id, capacity_id, target_units, quota_units,
      base_price_snapshot_idr, product_name_snapshot, sku_snapshot
    ) values (
      v_business_id, v_preorder_id, v_product.id, v_capacity.id, p_target_units, p_quota_units,
      v_product.base_price_idr, v_product.name, v_product.sku
    );
    return v_preorder_id;
  end if;

  if (private.lock_owned_preorder(v_preorder_id, p_expected_version)).status <> 'draft' then
    raise exception 'PREORDER_NOT_DRAFT';
  end if;

  update public.preorders
  set name = p_name, fulfillment_date = v_capacity.fulfillment_date, starts_at = p_starts_at, ends_at = p_ends_at
  where id = v_preorder_id;

  update public.preorder_items
  set product_id = v_product.id,
      capacity_id = v_capacity.id,
      target_units = p_target_units,
      quota_units = p_quota_units,
      base_price_snapshot_idr = v_product.base_price_idr,
      product_name_snapshot = v_product.name,
      sku_snapshot = v_product.sku
  where preorder_id = v_preorder_id;

  return v_preorder_id;
end;
$$;

--
-- Name: take_rate_limit(text, timestamp with time zone, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.take_rate_limit(p_key_hash text, p_window_start timestamp with time zone, p_expires_at timestamp with time zone, p_limit integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE used integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY' USING ERRCODE='42501'; END IF;
 IF p_limit<1 OR p_expires_at<=p_window_start THEN RAISE EXCEPTION 'INVALID_BUCKET' USING ERRCODE='22023'; END IF;
 INSERT INTO public.rate_limit_buckets(bucket_key_hash,window_start,count,expires_at) VALUES(p_key_hash,p_window_start,1,p_expires_at)
 ON CONFLICT(bucket_key_hash,window_start) DO UPDATE SET count=public.rate_limit_buckets.count+1 RETURNING count INTO used;
 RETURN used<=p_limit;
END $$;

--
-- Name: ai_generations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_generations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
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
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_generations_check CHECK ((((campaign_id IS NULL) AND (session_id IS NULL)) OR (preorder_id IS NOT NULL))),
    CONSTRAINT ai_generations_check1 CHECK (((status <> 'success'::text) OR ((output_json IS NOT NULL) AND (finished_at IS NOT NULL)))),
    CONSTRAINT ai_generations_check2 CHECK (((status <> 'running'::text) OR (started_at IS NOT NULL))),
    CONSTRAINT ai_generations_generation_type_check CHECK ((generation_type = ANY (ARRAY['strategies'::text, 'discussion'::text, 'blueprint'::text, 'evaluation'::text, 'memory'::text]))),
    CONSTRAINT ai_generations_input_hash_check CHECK ((input_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ai_generations_output_json_check CHECK ((jsonb_typeof(output_json) = 'object'::text)),
    CONSTRAINT ai_generations_request_key_check CHECK (((length(request_key) >= 1) AND (length(request_key) <= 128))),
    CONSTRAINT ai_generations_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text, 'invalid_output'::text])))
);

--
-- Name: business_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'owner'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_members_role_check CHECK ((role = 'owner'::text))
);

--
-- Name: businesses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.businesses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    slug character varying(140) NOT NULL,
    category character varying(80) NOT NULL,
    description text,
    public_contact character varying(120),
    pickup_instructions text NOT NULL,
    timezone character varying(64) DEFAULT 'Asia/Jakarta'::character varying NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    categories text[] NOT NULL,
    CONSTRAINT businesses_categories_valid CHECK (private.are_valid_business_categories(categories)),
    CONSTRAINT businesses_check CHECK (((length(btrim((name)::text)) > 0) AND (length(btrim((slug)::text)) > 0)))
);

--
-- Name: campaign_ai_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_ai_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    session_id uuid NOT NULL,
    sequence integer NOT NULL,
    role text NOT NULL,
    body_text text NOT NULL,
    proposal_json jsonb,
    context_hash text,
    ai_generation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_ai_messages_body_text_check CHECK (((length(body_text) >= 1) AND (length(body_text) <= 4000))),
    CONSTRAINT campaign_ai_messages_check CHECK (((role = 'assistant'::text) OR (proposal_json IS NULL))),
    CONSTRAINT campaign_ai_messages_context_hash_check CHECK ((context_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT campaign_ai_messages_proposal_json_check CHECK ((jsonb_typeof(proposal_json) = 'object'::text)),
    CONSTRAINT campaign_ai_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text]))),
    CONSTRAINT campaign_ai_messages_sequence_check CHECK ((sequence > 0))
);

--
-- Name: campaign_contents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_contents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    blueprint_id uuid NOT NULL,
    content_key text NOT NULL,
    channel text NOT NULL,
    content_type text NOT NULL,
    body text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_contents_body_check CHECK (((length(body) >= 1) AND (length(body) <= 2200))),
    CONSTRAINT campaign_contents_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'instagram'::text, 'landing_page'::text]))),
    CONSTRAINT campaign_contents_content_type_check CHECK ((content_type = ANY (ARRAY['headline'::text, 'caption'::text, 'cta'::text]))),
    CONSTRAINT campaign_contents_version_check CHECK ((version > 0))
);

--
-- Name: campaign_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    category text NOT NULL,
    description text,
    amount_idr bigint NOT NULL,
    incurred_at timestamp with time zone NOT NULL,
    voided_at timestamp with time zone,
    void_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_costs_amount_idr_check CHECK ((amount_idr >= 0)),
    CONSTRAINT campaign_costs_category_check CHECK ((category = ANY (ARRAY['advertising'::text, 'printing'::text, 'other'::text]))),
    CONSTRAINT campaign_costs_version_check CHECK ((version > 0))
);

--
-- Name: campaign_evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_evaluations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    blueprint_id uuid NOT NULL,
    metrics_schema_version integer NOT NULL,
    metrics_json jsonb NOT NULL,
    analysis_json jsonb,
    limitations_json jsonb NOT NULL,
    source_ai_generation_id uuid,
    evaluation_kind text NOT NULL,
    calculated_at timestamp with time zone NOT NULL,
    evaluated_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_evaluations_analysis_json_check CHECK ((jsonb_typeof(analysis_json) = 'object'::text)),
    CONSTRAINT campaign_evaluations_evaluation_kind_check CHECK ((evaluation_kind = ANY (ARRAY['provisional'::text, 'final'::text]))),
    CONSTRAINT campaign_evaluations_limitations_json_check CHECK ((jsonb_typeof(limitations_json) = 'array'::text)),
    CONSTRAINT campaign_evaluations_metrics_json_check CHECK ((jsonb_typeof(metrics_json) = 'object'::text)),
    CONSTRAINT campaign_evaluations_metrics_schema_version_check CHECK ((metrics_schema_version > 0))
);

--
-- Name: campaign_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_memories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    source_evaluation_id uuid NOT NULL,
    source_blueprint_id uuid,
    source_version integer NOT NULL,
    summary_text text NOT NULL,
    lessons_json jsonb NOT NULL,
    limitations_json jsonb NOT NULL,
    content_hash text NOT NULL,
    review_status text NOT NULL,
    embedding_status text NOT NULL,
    embedding extensions.vector(768),
    embedding_model text,
    embedding_profile text,
    embedding_version integer NOT NULL,
    approved_at timestamp with time zone,
    indexed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_memories_check CHECK (((review_status <> 'approved'::text) OR (approved_at IS NOT NULL))),
    CONSTRAINT campaign_memories_check1 CHECK (((embedding_status <> 'ready'::text) OR ((review_status = 'approved'::text) AND (embedding IS NOT NULL) AND (embedding_model IS NOT NULL) AND (embedding_profile IS NOT NULL) AND (indexed_at IS NOT NULL)))),
    CONSTRAINT campaign_memories_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT campaign_memories_embedding_status_check CHECK ((embedding_status = ANY (ARRAY['queued'::text, 'ready'::text, 'failed'::text, 'stale'::text]))),
    CONSTRAINT campaign_memories_embedding_version_check CHECK ((embedding_version > 0)),
    CONSTRAINT campaign_memories_limitations_json_check CHECK ((jsonb_typeof(limitations_json) = 'array'::text)),
    CONSTRAINT campaign_memories_review_status_check CHECK ((review_status = ANY (ARRAY['draft'::text, 'approved'::text]))),
    CONSTRAINT campaign_memories_source_version_check CHECK ((source_version > 0))
);

--
-- Name: campaign_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    blueprint_id uuid NOT NULL,
    task_key text NOT NULL,
    title text NOT NULL,
    description text,
    channel text,
    due_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_tasks_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'instagram'::text, 'offline'::text]))),
    CONSTRAINT campaign_tasks_title_check CHECK (((length(title) >= 1) AND (length(title) <= 160))),
    CONSTRAINT campaign_tasks_version_check CHECK ((version > 0))
);

--
-- Name: capacity_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capacity_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    preorder_item_id uuid,
    capacity_id uuid NOT NULL,
    quantity integer NOT NULL,
    state text NOT NULL,
    expires_at timestamp with time zone,
    released_at timestamp with time zone,
    release_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT capacity_reservations_check CHECK (((state <> 'held'::text) OR (expires_at IS NOT NULL))),
    CONSTRAINT capacity_reservations_check1 CHECK (((state <> 'released'::text) OR (released_at IS NOT NULL))),
    CONSTRAINT capacity_reservations_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT capacity_reservations_state_check CHECK ((state = ANY (ARRAY['held'::text, 'allocated'::text, 'released'::text])))
);

--
-- Name: domain_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.domain_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    command_key text,
    event_type text NOT NULL,
    actor_type text NOT NULL,
    actor_user_id uuid,
    safe_details_json jsonb,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT domain_events_safe_details_json_check CHECK ((jsonb_typeof(safe_details_json) = 'object'::text))
);

--
-- Name: order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    order_id uuid NOT NULL,
    command_key text,
    event_type text NOT NULL,
    from_state text,
    to_state text,
    actor_type text NOT NULL,
    actor_user_id uuid,
    details_json jsonb,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_events_actor_type_check CHECK ((actor_type = ANY (ARRAY['owner'::text, 'system'::text, 'provider'::text]))),
    CONSTRAINT order_events_details_json_check CHECK ((jsonb_typeof(details_json) = 'object'::text))
);

--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    order_id uuid NOT NULL,
    preorder_item_id uuid,
    product_id uuid NOT NULL,
    product_name_snapshot text NOT NULL,
    sku_snapshot text NOT NULL,
    quantity integer NOT NULL,
    base_unit_price_idr bigint NOT NULL,
    discount_bps_snapshot integer NOT NULL,
    discount_per_unit_idr bigint NOT NULL,
    final_unit_price_idr bigint NOT NULL,
    variable_cost_per_unit_idr bigint,
    cost_quality_snapshot text NOT NULL,
    line_total_idr bigint NOT NULL,
    pricing_campaign_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_items_base_unit_price_idr_check CHECK ((base_unit_price_idr >= 0)),
    CONSTRAINT order_items_check CHECK (((cost_quality_snapshot = 'unknown'::text) = (variable_cost_per_unit_idr IS NULL))),
    CONSTRAINT order_items_check1 CHECK (((base_unit_price_idr > 0) AND (final_unit_price_idr > 0))),
    CONSTRAINT order_items_check2 CHECK (((discount_per_unit_idr)::numeric = floor((((base_unit_price_idr)::numeric * (discount_bps_snapshot)::numeric) / (10000)::numeric)))),
    CONSTRAINT order_items_check3 CHECK ((final_unit_price_idr = (base_unit_price_idr - discount_per_unit_idr))),
    CONSTRAINT order_items_check4 CHECK (((line_total_idr)::numeric = ((final_unit_price_idr)::numeric * (quantity)::numeric))),
    CONSTRAINT order_items_cost_quality_snapshot_check CHECK ((cost_quality_snapshot = ANY (ARRAY['unknown'::text, 'estimated'::text, 'verified'::text]))),
    CONSTRAINT order_items_discount_bps_snapshot_check CHECK ((discount_bps_snapshot >= 0)),
    CONSTRAINT order_items_discount_bps_snapshot_check1 CHECK (((discount_bps_snapshot >= 0) AND (discount_bps_snapshot <= 9999))),
    CONSTRAINT order_items_discount_per_unit_idr_check CHECK ((discount_per_unit_idr >= 0)),
    CONSTRAINT order_items_final_unit_price_idr_check CHECK ((final_unit_price_idr >= 0)),
    CONSTRAINT order_items_line_total_idr_check CHECK ((line_total_idr >= 0)),
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT order_items_variable_cost_per_unit_idr_check CHECK ((variable_cost_per_unit_idr >= 0))
);

--
-- Name: order_production_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_production_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    cost_kind text NOT NULL,
    quantity integer NOT NULL,
    cost_per_unit_idr bigint,
    amount_idr bigint,
    quality text NOT NULL,
    incurred_at timestamp with time zone NOT NULL,
    resolved_by_user_id uuid,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_production_costs_amount_idr_check CHECK ((amount_idr >= 0)),
    CONSTRAINT order_production_costs_check CHECK (((quality = 'unknown'::text) = (cost_per_unit_idr IS NULL))),
    CONSTRAINT order_production_costs_check1 CHECK (((cost_per_unit_idr IS NULL) = (amount_idr IS NULL))),
    CONSTRAINT order_production_costs_check2 CHECK (((amount_idr)::numeric = ((cost_per_unit_idr)::numeric * (quantity)::numeric))),
    CONSTRAINT order_production_costs_cost_kind_check CHECK ((cost_kind = 'variable_production'::text)),
    CONSTRAINT order_production_costs_cost_per_unit_idr_check CHECK ((cost_per_unit_idr >= 0)),
    CONSTRAINT order_production_costs_quality_check CHECK ((quality = ANY (ARRAY['unknown'::text, 'estimated'::text, 'verified'::text]))),
    CONSTRAINT order_production_costs_quantity_check CHECK ((quantity >= 0))
);

--
-- Name: payment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    provider_event_key text NOT NULL,
    payload_hash text NOT NULL,
    provider_status text NOT NULL,
    signature_valid boolean NOT NULL,
    verified_at timestamp with time zone NOT NULL,
    processed_at timestamp with time zone,
    outcome text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_events_payload_hash_check CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))
);

--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    sku character varying(80) NOT NULL,
    description text,
    photo_path text,
    base_price_idr bigint NOT NULL,
    variable_cost_idr bigint,
    cost_quality text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    gallery_photo_paths text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT products_base_price_idr_check CHECK ((base_price_idr > 0)),
    CONSTRAINT products_check CHECK (((cost_quality = 'unknown'::text) = (variable_cost_idr IS NULL))),
    CONSTRAINT products_check1 CHECK (((length(btrim((name)::text)) > 0) AND (length(btrim((sku)::text)) > 0))),
    CONSTRAINT products_cost_quality_check CHECK ((cost_quality = ANY (ARRAY['unknown'::text, 'estimated'::text, 'verified'::text]))),
    CONSTRAINT products_gallery_photo_paths_max CHECK ((cardinality(gallery_photo_paths) <= 4)),
    CONSTRAINT products_gallery_requires_primary CHECK (((cardinality(gallery_photo_paths) = 0) OR (photo_path IS NOT NULL))),
    CONSTRAINT products_variable_cost_idr_check CHECK ((variable_cost_idr >= 0)),
    CONSTRAINT products_version_check CHECK ((version > 0))
);

--
-- Name: rate_limit_buckets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_buckets (
    bucket_key_hash text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT rate_limit_buckets_bucket_key_hash_check CHECK ((bucket_key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT rate_limit_buckets_count_check CHECK ((count >= 0))
);

--
-- Name: ai_generations ai_generations_business_id_generation_type_request_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generations
    ADD CONSTRAINT ai_generations_business_id_generation_type_request_key_key UNIQUE (business_id, generation_type, request_key);

--
-- Name: ai_generations ai_generations_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generations
    ADD CONSTRAINT ai_generations_id_business_id_key UNIQUE (id, business_id);

--
-- Name: ai_generations ai_generations_id_business_id_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generations
    ADD CONSTRAINT ai_generations_id_business_id_session_id_key UNIQUE (id, business_id, session_id);

--
-- Name: ai_generations ai_generations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generations
    ADD CONSTRAINT ai_generations_pkey PRIMARY KEY (id);

--
-- Name: business_members business_members_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_business_id_key UNIQUE (business_id);

--
-- Name: business_members business_members_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_id_business_id_key UNIQUE (id, business_id);

--
-- Name: business_members business_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_pkey PRIMARY KEY (id);

--
-- Name: business_members business_members_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_user_id_key UNIQUE (user_id);

--
-- Name: businesses businesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_pkey PRIMARY KEY (id);

--
-- Name: businesses businesses_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_slug_key UNIQUE (slug);

--
-- Name: campaign_ai_messages campaign_ai_messages_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_messages
    ADD CONSTRAINT campaign_ai_messages_id_business_id_key UNIQUE (id, business_id);

--
-- Name: campaign_ai_messages campaign_ai_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_messages
    ADD CONSTRAINT campaign_ai_messages_pkey PRIMARY KEY (id);

--
-- Name: campaign_ai_messages campaign_ai_messages_session_id_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_messages
    ADD CONSTRAINT campaign_ai_messages_session_id_sequence_key UNIQUE (session_id, sequence);

--
-- Name: campaign_ai_sessions campaign_ai_sessions_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_sessions
    ADD CONSTRAINT campaign_ai_sessions_id_business_id_key UNIQUE (id, business_id);

--
-- Name: campaign_ai_sessions campaign_ai_sessions_id_business_id_preorder_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_sessions
    ADD CONSTRAINT campaign_ai_sessions_id_business_id_preorder_id_key UNIQUE (id, business_id, preorder_id);

--
-- Name: campaign_ai_sessions campaign_ai_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_sessions
    ADD CONSTRAINT campaign_ai_sessions_pkey PRIMARY KEY (id);

--
-- Name: campaign_blueprints campaign_blueprints_campaign_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_blueprints
    ADD CONSTRAINT campaign_blueprints_campaign_id_version_key UNIQUE (campaign_id, version);

--
-- Name: campaign_blueprints campaign_blueprints_id_business_id_campaign_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_blueprints
    ADD CONSTRAINT campaign_blueprints_id_business_id_campaign_id_key UNIQUE (id, business_id, campaign_id);

--
-- Name: campaign_blueprints campaign_blueprints_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_blueprints
    ADD CONSTRAINT campaign_blueprints_id_business_id_key UNIQUE (id, business_id);

--
-- Name: campaign_blueprints campaign_blueprints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_blueprints
    ADD CONSTRAINT campaign_blueprints_pkey PRIMARY KEY (id);

--
-- Name: campaign_contents campaign_contents_blueprint_id_content_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_contents
    ADD CONSTRAINT campaign_contents_blueprint_id_content_key_key UNIQUE (blueprint_id, content_key);

--
-- Name: campaign_contents campaign_contents_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_contents
    ADD CONSTRAINT campaign_contents_id_business_id_key UNIQUE (id, business_id);

--
-- Name: campaign_contents campaign_contents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_contents
    ADD CONSTRAINT campaign_contents_pkey PRIMARY KEY (id);

--
-- Name: campaign_costs campaign_costs_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_costs
    ADD CONSTRAINT campaign_costs_id_business_id_key UNIQUE (id, business_id);

--
-- Name: campaign_costs campaign_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_costs
    ADD CONSTRAINT campaign_costs_pkey PRIMARY KEY (id);

--
-- Name: campaign_evaluations campaign_evaluations_id_business_id_campaign_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_evaluations
    ADD CONSTRAINT campaign_evaluations_id_business_id_campaign_id_key UNIQUE (id, business_id, campaign_id);

--
-- Name: campaign_evaluations campaign_evaluations_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_evaluations
    ADD CONSTRAINT campaign_evaluations_id_business_id_key UNIQUE (id, business_id);

--
-- Name: campaign_evaluations campaign_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_evaluations
    ADD CONSTRAINT campaign_evaluations_pkey PRIMARY KEY (id);

--
-- Name: campaign_memories campaign_memories_business_id_source_evaluation_id_source_v_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_memories
    ADD CONSTRAINT campaign_memories_business_id_source_evaluation_id_source_v_key UNIQUE (business_id, source_evaluation_id, source_version);

--
-- Name: campaign_memories campaign_memories_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_memories
    ADD CONSTRAINT campaign_memories_id_business_id_key UNIQUE (id, business_id);

--
-- Name: campaign_memories campaign_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_memories
    ADD CONSTRAINT campaign_memories_pkey PRIMARY KEY (id);

--
-- Name: campaign_tasks campaign_tasks_blueprint_id_task_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_tasks
    ADD CONSTRAINT campaign_tasks_blueprint_id_task_key_key UNIQUE (blueprint_id, task_key);

--
-- Name: campaign_tasks campaign_tasks_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_tasks
    ADD CONSTRAINT campaign_tasks_id_business_id_key UNIQUE (id, business_id);

--
-- Name: campaign_tasks campaign_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_tasks
    ADD CONSTRAINT campaign_tasks_pkey PRIMARY KEY (id);

--
-- Name: campaigns campaigns_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_id_business_id_key UNIQUE (id, business_id);

--
-- Name: campaigns campaigns_id_business_id_preorder_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_id_business_id_preorder_id_key UNIQUE (id, business_id, preorder_id);

--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);

--
-- Name: campaigns campaigns_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_slug_key UNIQUE (slug);

--
-- Name: capacity_reservations capacity_reservations_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_reservations
    ADD CONSTRAINT capacity_reservations_id_business_id_key UNIQUE (id, business_id);

--
-- Name: capacity_reservations capacity_reservations_order_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_reservations
    ADD CONSTRAINT capacity_reservations_order_item_id_key UNIQUE (order_item_id);

--
-- Name: capacity_reservations capacity_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_reservations
    ADD CONSTRAINT capacity_reservations_pkey PRIMARY KEY (id);

--
-- Name: domain_events domain_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_events
    ADD CONSTRAINT domain_events_pkey PRIMARY KEY (id);

--
-- Name: job_runs job_runs_job_type_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_job_type_dedupe_key_key UNIQUE (job_type, dedupe_key);

--
-- Name: job_runs job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (id);

--
-- Name: order_events order_events_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_id_business_id_key UNIQUE (id, business_id);

--
-- Name: order_events order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_pkey PRIMARY KEY (id);

--
-- Name: order_items order_items_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_id_business_id_key UNIQUE (id, business_id);

--
-- Name: order_items order_items_id_business_id_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_id_business_id_order_id_key UNIQUE (id, business_id, order_id);

--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);

--
-- Name: order_production_costs order_production_costs_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_production_costs
    ADD CONSTRAINT order_production_costs_id_business_id_key UNIQUE (id, business_id);

--
-- Name: order_production_costs order_production_costs_order_item_id_cost_kind_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_production_costs
    ADD CONSTRAINT order_production_costs_order_item_id_cost_kind_key UNIQUE (order_item_id, cost_kind);

--
-- Name: order_production_costs order_production_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_production_costs
    ADD CONSTRAINT order_production_costs_pkey PRIMARY KEY (id);

--
-- Name: orders orders_business_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_business_id_idempotency_key_key UNIQUE (business_id, idempotency_key);

--
-- Name: orders orders_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_id_business_id_key UNIQUE (id, business_id);

--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

--
-- Name: orders orders_private_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_private_token_hash_key UNIQUE (private_token_hash);

--
-- Name: orders orders_public_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_public_order_number_key UNIQUE (public_order_number);

--
-- Name: payment_events payment_events_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_id_business_id_key UNIQUE (id, business_id);

--
-- Name: payment_events payment_events_payment_id_provider_event_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_payment_id_provider_event_key_key UNIQUE (payment_id, provider_event_key);

--
-- Name: payment_events payment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);

--
-- Name: payments payments_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_id_business_id_key UNIQUE (id, business_id);

--
-- Name: payments payments_order_id_attempt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_attempt_number_key UNIQUE (order_id, attempt_number);

--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

--
-- Name: payments payments_provider_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_provider_order_id_key UNIQUE (provider_order_id);

--
-- Name: payments payments_provider_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_provider_transaction_id_key UNIQUE (provider_transaction_id);

--
-- Name: preorder_items preorder_items_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preorder_items
    ADD CONSTRAINT preorder_items_id_business_id_key UNIQUE (id, business_id);

--
-- Name: preorder_items preorder_items_id_business_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preorder_items
    ADD CONSTRAINT preorder_items_id_business_id_product_id_key UNIQUE (id, business_id, product_id);

--
-- Name: preorder_items preorder_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preorder_items
    ADD CONSTRAINT preorder_items_pkey PRIMARY KEY (id);

--
-- Name: preorder_items preorder_items_preorder_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preorder_items
    ADD CONSTRAINT preorder_items_preorder_id_key UNIQUE (preorder_id);

--
-- Name: preorders preorders_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preorders
    ADD CONSTRAINT preorders_id_business_id_key UNIQUE (id, business_id);

--
-- Name: preorders preorders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preorders
    ADD CONSTRAINT preorders_pkey PRIMARY KEY (id);

--
-- Name: production_capacity production_capacity_business_id_product_id_fulfillment_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_capacity
    ADD CONSTRAINT production_capacity_business_id_product_id_fulfillment_date_key UNIQUE (business_id, product_id, fulfillment_date);

--
-- Name: production_capacity production_capacity_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_capacity
    ADD CONSTRAINT production_capacity_id_business_id_key UNIQUE (id, business_id);

--
-- Name: production_capacity production_capacity_id_business_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_capacity
    ADD CONSTRAINT production_capacity_id_business_id_product_id_key UNIQUE (id, business_id, product_id);

--
-- Name: production_capacity production_capacity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_capacity
    ADD CONSTRAINT production_capacity_pkey PRIMARY KEY (id);

--
-- Name: products products_business_id_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_business_id_sku_key UNIQUE (business_id, sku);

--
-- Name: products products_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_id_business_id_key UNIQUE (id, business_id);

--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);

--
-- Name: rate_limit_buckets rate_limit_buckets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_buckets
    ADD CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (bucket_key_hash, window_start);

--
-- Name: ai_one_running_session; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_one_running_session ON public.ai_generations USING btree (session_id) WHERE ((status = 'running'::text) AND (session_id IS NOT NULL));

--
-- Name: blueprints_one_approved; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX blueprints_one_approved ON public.campaign_blueprints USING btree (campaign_id) WHERE (approval_status = 'approved'::text);

--
-- Name: campaign_ai_sessions_read_0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_ai_sessions_read_0 ON public.campaign_ai_sessions USING btree (business_id, preorder_id, created_at);

--
-- Name: campaign_evaluations_read_0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_evaluations_read_0 ON public.campaign_evaluations USING btree (business_id, campaign_id, calculated_at);

--
-- Name: campaign_memories_read_0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_memories_read_0 ON public.campaign_memories USING btree (business_id, review_status, embedding_status, embedding_model, embedding_profile);

--
-- Name: campaigns_one_published; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX campaigns_one_published ON public.campaigns USING btree (preorder_id) WHERE (status = 'published'::text);

--
-- Name: campaigns_read_0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaigns_read_0 ON public.campaigns USING btree (preorder_id, status);

--
-- Name: capacity_reservations_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capacity_reservations_order_idx ON public.capacity_reservations USING btree (order_id);

--
-- Name: capacity_reservations_read_0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capacity_reservations_read_0 ON public.capacity_reservations USING btree (capacity_id, state, expires_at);

--
-- Name: capacity_reservations_read_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capacity_reservations_read_1 ON public.capacity_reservations USING btree (preorder_item_id, state, expires_at);

--
-- Name: domain_events_command; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX domain_events_command ON public.domain_events USING btree (business_id, entity_type, entity_id, event_type, command_key) WHERE (command_key IS NOT NULL);

--
-- Name: domain_events_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX domain_events_entity_idx ON public.domain_events USING btree (business_id, entity_type, entity_id, occurred_at);

--
-- Name: job_runs_read_0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_runs_read_0 ON public.job_runs USING btree (status, next_run_at);

--
-- Name: messages_generation_role; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX messages_generation_role ON public.campaign_ai_messages USING btree (ai_generation_id, role) WHERE (ai_generation_id IS NOT NULL);

--
-- Name: order_events_command; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_events_command ON public.order_events USING btree (business_id, command_key) WHERE (command_key IS NOT NULL);

--
-- Name: order_events_read_0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_events_read_0 ON public.order_events USING btree (order_id, occurred_at);

--
-- Name: order_items_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_order_idx ON public.order_items USING btree (order_id);

--
-- Name: orders_business_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_business_status_created_idx ON public.orders USING btree (business_id, order_status, created_at);

--
-- Name: orders_preorder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_preorder_idx ON public.orders USING btree (preorder_id);

--
-- Name: orders_read_0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_read_0 ON public.orders USING btree (business_id, preorder_id, created_at);

--
-- Name: payments_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payments_one_active ON public.payments USING btree (order_id) WHERE is_active_attempt;

--
-- Name: payments_one_applied; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payments_one_applied ON public.payments USING btree (order_id) WHERE (applied_at IS NOT NULL);

--
-- Name: payments_read_0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_read_0 ON public.payments USING btree (business_id, order_id, status);

--
-- Name: preorder_items_capacity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX preorder_items_capacity_idx ON public.preorder_items USING btree (capacity_id);

--
-- Name: preorders_one_published; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX preorders_one_published ON public.preorders USING btree (business_id, fulfillment_date) WHERE (status = 'published'::text);

--
-- Name: preorders_read_0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX preorders_read_0 ON public.preorders USING btree (business_id, status, created_at);

--
-- Name: preorders_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX preorders_slug_key ON public.preorders USING btree (slug);

--
-- Name: products_read_0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_read_0 ON public.products USING btree (business_id, is_active);

--
-- Name: campaign_ai_messages append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER append_only BEFORE DELETE OR UPDATE ON public.campaign_ai_messages FOR EACH ROW EXECUTE FUNCTION private.append_only();

--
-- Name: campaign_evaluations append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER append_only BEFORE DELETE OR UPDATE ON public.campaign_evaluations FOR EACH ROW EXECUTE FUNCTION private.append_only();

--
-- Name: domain_events append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER append_only BEFORE DELETE OR UPDATE ON public.domain_events FOR EACH ROW EXECUTE FUNCTION private.append_only();

--
-- Name: order_events append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER append_only BEFORE DELETE OR UPDATE ON public.order_events FOR EACH ROW EXECUTE FUNCTION private.append_only();

--
-- Name: campaign_blueprints blueprint_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER blueprint_guard BEFORE UPDATE ON public.campaign_blueprints FOR EACH ROW EXECUTE FUNCTION private.guard_blueprint();

--
-- Name: businesses business_category_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER business_category_sync BEFORE INSERT OR UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION private.sync_business_category();

--
-- Name: campaigns campaign_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER campaign_guard BEFORE INSERT OR UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION private.guard_campaign();

--
-- Name: production_capacity capacity_commitment_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER capacity_commitment_guard BEFORE UPDATE ON public.production_capacity FOR EACH ROW EXECUTE FUNCTION private.guard_capacity_update();

--
-- Name: production_capacity capacity_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER capacity_guard BEFORE UPDATE ON public.production_capacity FOR EACH ROW EXECUTE FUNCTION private.guard_capacity();

--
-- Name: campaign_costs cost_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cost_changed AFTER INSERT OR UPDATE ON public.campaign_costs FOR EACH ROW EXECUTE FUNCTION private.cost_changed();

--
-- Name: campaigns evaluation_completion_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER evaluation_completion_guard BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION private.guard_campaign_completion();

--
-- Name: campaign_evaluations evaluation_insert_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER evaluation_insert_guard BEFORE INSERT ON public.campaign_evaluations FOR EACH ROW EXECUTE FUNCTION private.guard_evaluation_insert();

--
-- Name: campaign_blueprints evaluation_source_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER evaluation_source_guard BEFORE INSERT OR UPDATE ON public.campaign_blueprints FOR EACH ROW EXECUTE FUNCTION private.guard_evaluation_source_write();

--
-- Name: campaign_contents evaluation_source_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER evaluation_source_guard BEFORE INSERT OR UPDATE ON public.campaign_contents FOR EACH ROW EXECUTE FUNCTION private.guard_evaluation_source_write();

--
-- Name: campaign_costs evaluation_source_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER evaluation_source_guard BEFORE INSERT OR UPDATE ON public.campaign_costs FOR EACH ROW EXECUTE FUNCTION private.guard_evaluation_source_write();

--
-- Name: campaign_tasks evaluation_source_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER evaluation_source_guard BEFORE INSERT OR UPDATE ON public.campaign_tasks FOR EACH ROW EXECUTE FUNCTION private.guard_evaluation_source_write();

--
-- Name: campaign_memories memory_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER memory_guard BEFORE UPDATE ON public.campaign_memories FOR EACH ROW EXECUTE FUNCTION private.guard_memory();

--
-- Name: job_runs memory_job_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER memory_job_guard BEFORE INSERT OR UPDATE ON public.job_runs FOR EACH ROW EXECUTE FUNCTION private.guard_memory_job();

--
-- Name: campaign_memories memory_pipeline_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER memory_pipeline_guard BEFORE INSERT OR UPDATE ON public.campaign_memories FOR EACH ROW EXECUTE FUNCTION private.guard_memory_pipeline();

--
-- Name: capacity_reservations no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER no_delete BEFORE DELETE ON public.capacity_reservations FOR EACH ROW EXECUTE FUNCTION private.append_only();

--
-- Name: order_production_costs no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER no_delete BEFORE DELETE ON public.order_production_costs FOR EACH ROW EXECUTE FUNCTION private.append_only();

--
-- Name: payment_events no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER no_delete BEFORE DELETE ON public.payment_events FOR EACH ROW EXECUTE FUNCTION private.append_only();

--
-- Name: payments no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER no_delete BEFORE DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.append_only();

--
-- Name: order_items order_item_snapshot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_item_snapshot BEFORE DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION private.guard_order_items();

--
-- Name: orders order_totals_header; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER order_totals_header AFTER INSERT OR UPDATE ON public.orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_order_totals();

--
-- Name: order_items order_totals_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER order_totals_items AFTER INSERT ON public.order_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_order_totals();

--
-- Name: payments payment_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payment_guard BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.guard_payment();

--
-- Name: preorders preorder_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER preorder_guard BEFORE INSERT OR UPDATE ON public.preorders FOR EACH ROW EXECUTE FUNCTION private.guard_preorder();

--
-- Name: preorder_items preorder_item_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER preorder_item_guard BEFORE INSERT OR UPDATE ON public.preorder_items FOR EACH ROW EXECUTE FUNCTION private.guard_preorder_item();

--
-- Name: capacity_reservations reservation_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reservation_guard BEFORE INSERT OR UPDATE ON public.capacity_reservations FOR EACH ROW EXECUTE FUNCTION private.guard_reservation();

--
-- Name: campaign_memories synthetic_finalization_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER synthetic_finalization_guard BEFORE INSERT OR UPDATE ON public.campaign_memories FOR EACH ROW EXECUTE FUNCTION private.guard_synthetic_finalization_memory();

--
-- Name: businesses touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: campaign_ai_sessions touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.campaign_ai_sessions FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: campaign_contents touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.campaign_contents FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: campaign_costs touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.campaign_costs FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: campaign_memories touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.campaign_memories FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: campaign_tasks touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.campaign_tasks FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: campaigns touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: capacity_reservations touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.capacity_reservations FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: orders touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: payments touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: preorder_items touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.preorder_items FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: preorders touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.preorders FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: production_capacity touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.production_capacity FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: products touch_row; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_row BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.touch_row();

--
-- Name: ai_generations ai_generations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generations
    ADD CONSTRAINT ai_generations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: ai_generations ai_generations_campaign_id_business_id_preorder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generations
    ADD CONSTRAINT ai_generations_campaign_id_business_id_preorder_id_fkey FOREIGN KEY (campaign_id, business_id, preorder_id) REFERENCES public.campaigns(id, business_id, preorder_id) ON DELETE RESTRICT;

--
-- Name: ai_generations ai_generations_preorder_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generations
    ADD CONSTRAINT ai_generations_preorder_id_business_id_fkey FOREIGN KEY (preorder_id, business_id) REFERENCES public.preorders(id, business_id) ON DELETE RESTRICT;

--
-- Name: ai_generations ai_generations_session_id_business_id_preorder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generations
    ADD CONSTRAINT ai_generations_session_id_business_id_preorder_id_fkey FOREIGN KEY (session_id, business_id, preorder_id) REFERENCES public.campaign_ai_sessions(id, business_id, preorder_id) ON DELETE RESTRICT;

--
-- Name: business_members business_members_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: business_members business_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: campaign_ai_messages campaign_ai_messages_ai_generation_id_business_id_session__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_messages
    ADD CONSTRAINT campaign_ai_messages_ai_generation_id_business_id_session__fkey FOREIGN KEY (ai_generation_id, business_id, session_id) REFERENCES public.ai_generations(id, business_id, session_id) ON DELETE RESTRICT;

--
-- Name: campaign_ai_messages campaign_ai_messages_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_messages
    ADD CONSTRAINT campaign_ai_messages_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: campaign_ai_messages campaign_ai_messages_session_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_messages
    ADD CONSTRAINT campaign_ai_messages_session_id_business_id_fkey FOREIGN KEY (session_id, business_id) REFERENCES public.campaign_ai_sessions(id, business_id) ON DELETE RESTRICT;

--
-- Name: campaign_ai_sessions campaign_ai_sessions_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_sessions
    ADD CONSTRAINT campaign_ai_sessions_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: campaign_ai_sessions campaign_ai_sessions_campaign_id_business_id_preorder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_sessions
    ADD CONSTRAINT campaign_ai_sessions_campaign_id_business_id_preorder_id_fkey FOREIGN KEY (campaign_id, business_id, preorder_id) REFERENCES public.campaigns(id, business_id, preorder_id) ON DELETE RESTRICT;

--
-- Name: campaign_ai_sessions campaign_ai_sessions_preorder_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_ai_sessions
    ADD CONSTRAINT campaign_ai_sessions_preorder_id_business_id_fkey FOREIGN KEY (preorder_id, business_id) REFERENCES public.preorders(id, business_id) ON DELETE RESTRICT;

--
-- Name: campaign_blueprints campaign_blueprints_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_blueprints
    ADD CONSTRAINT campaign_blueprints_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: campaign_blueprints campaign_blueprints_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_blueprints
    ADD CONSTRAINT campaign_blueprints_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: campaign_blueprints campaign_blueprints_campaign_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_blueprints
    ADD CONSTRAINT campaign_blueprints_campaign_id_business_id_fkey FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT;

--
-- Name: campaign_blueprints campaign_blueprints_source_ai_generation_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_blueprints
    ADD CONSTRAINT campaign_blueprints_source_ai_generation_id_business_id_fkey FOREIGN KEY (source_ai_generation_id, business_id) REFERENCES public.ai_generations(id, business_id) ON DELETE RESTRICT;

--
-- Name: campaign_contents campaign_contents_blueprint_id_business_id_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_contents
    ADD CONSTRAINT campaign_contents_blueprint_id_business_id_campaign_id_fkey FOREIGN KEY (blueprint_id, business_id, campaign_id) REFERENCES public.campaign_blueprints(id, business_id, campaign_id) ON DELETE RESTRICT;

--
-- Name: campaign_contents campaign_contents_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_contents
    ADD CONSTRAINT campaign_contents_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: campaign_contents campaign_contents_campaign_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_contents
    ADD CONSTRAINT campaign_contents_campaign_id_business_id_fkey FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT;

--
-- Name: campaign_costs campaign_costs_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_costs
    ADD CONSTRAINT campaign_costs_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: campaign_costs campaign_costs_campaign_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_costs
    ADD CONSTRAINT campaign_costs_campaign_id_business_id_fkey FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT;

--
-- Name: campaign_evaluations campaign_evaluations_blueprint_id_business_id_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_evaluations
    ADD CONSTRAINT campaign_evaluations_blueprint_id_business_id_campaign_id_fkey FOREIGN KEY (blueprint_id, business_id, campaign_id) REFERENCES public.campaign_blueprints(id, business_id, campaign_id) ON DELETE RESTRICT;

--
-- Name: campaign_evaluations campaign_evaluations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_evaluations
    ADD CONSTRAINT campaign_evaluations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: campaign_evaluations campaign_evaluations_campaign_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_evaluations
    ADD CONSTRAINT campaign_evaluations_campaign_id_business_id_fkey FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT;

--
-- Name: campaign_evaluations campaign_evaluations_source_ai_generation_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_evaluations
    ADD CONSTRAINT campaign_evaluations_source_ai_generation_id_business_id_fkey FOREIGN KEY (source_ai_generation_id, business_id) REFERENCES public.ai_generations(id, business_id) ON DELETE RESTRICT;

--
-- Name: campaign_memories campaign_memories_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_memories
    ADD CONSTRAINT campaign_memories_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: campaign_memories campaign_memories_campaign_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_memories
    ADD CONSTRAINT campaign_memories_campaign_id_business_id_fkey FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT;

--
-- Name: campaign_memories campaign_memories_source_blueprint_id_business_id_campaign_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_memories
    ADD CONSTRAINT campaign_memories_source_blueprint_id_business_id_campaign_fkey FOREIGN KEY (source_blueprint_id, business_id, campaign_id) REFERENCES public.campaign_blueprints(id, business_id, campaign_id) ON DELETE RESTRICT;

--
-- Name: campaign_memories campaign_memories_source_evaluation_id_business_id_campaig_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_memories
    ADD CONSTRAINT campaign_memories_source_evaluation_id_business_id_campaig_fkey FOREIGN KEY (source_evaluation_id, business_id, campaign_id) REFERENCES public.campaign_evaluations(id, business_id, campaign_id) ON DELETE RESTRICT;

--
-- Name: campaign_tasks campaign_tasks_blueprint_id_business_id_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_tasks
    ADD CONSTRAINT campaign_tasks_blueprint_id_business_id_campaign_id_fkey FOREIGN KEY (blueprint_id, business_id, campaign_id) REFERENCES public.campaign_blueprints(id, business_id, campaign_id) ON DELETE RESTRICT;

--
-- Name: campaign_tasks campaign_tasks_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_tasks
    ADD CONSTRAINT campaign_tasks_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: campaign_tasks campaign_tasks_campaign_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_tasks
    ADD CONSTRAINT campaign_tasks_campaign_id_business_id_fkey FOREIGN KEY (campaign_id, business_id) REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT;

--
-- Name: campaigns campaigns_active_blueprint_id_business_id_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_active_blueprint_id_business_id_id_fkey FOREIGN KEY (active_blueprint_id, business_id, id) REFERENCES public.campaign_blueprints(id, business_id, campaign_id) ON DELETE RESTRICT;

--
-- Name: campaigns campaigns_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: campaigns campaigns_preorder_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_preorder_id_business_id_fkey FOREIGN KEY (preorder_id, business_id) REFERENCES public.preorders(id, business_id) ON DELETE RESTRICT;

--
-- Name: campaigns campaigns_published_blueprint_id_business_id_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_published_blueprint_id_business_id_id_fkey FOREIGN KEY (published_blueprint_id, business_id, id) REFERENCES public.campaign_blueprints(id, business_id, campaign_id) ON DELETE RESTRICT;

--
-- Name: capacity_reservations capacity_reservations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_reservations
    ADD CONSTRAINT capacity_reservations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: capacity_reservations capacity_reservations_capacity_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_reservations
    ADD CONSTRAINT capacity_reservations_capacity_id_business_id_fkey FOREIGN KEY (capacity_id, business_id) REFERENCES public.production_capacity(id, business_id) ON DELETE RESTRICT;

--
-- Name: capacity_reservations capacity_reservations_order_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_reservations
    ADD CONSTRAINT capacity_reservations_order_id_business_id_fkey FOREIGN KEY (order_id, business_id) REFERENCES public.orders(id, business_id) ON DELETE RESTRICT;

--
-- Name: capacity_reservations capacity_reservations_order_item_id_business_id_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_reservations
    ADD CONSTRAINT capacity_reservations_order_item_id_business_id_order_id_fkey FOREIGN KEY (order_item_id, business_id, order_id) REFERENCES public.order_items(id, business_id, order_id) ON DELETE RESTRICT;

--
-- Name: capacity_reservations capacity_reservations_preorder_item_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_reservations
    ADD CONSTRAINT capacity_reservations_preorder_item_id_business_id_fkey FOREIGN KEY (preorder_item_id, business_id) REFERENCES public.preorder_items(id, business_id) ON DELETE RESTRICT;

--
-- Name: domain_events domain_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_events
    ADD CONSTRAINT domain_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: domain_events domain_events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_events
    ADD CONSTRAINT domain_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: job_runs job_runs_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: order_events order_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: order_events order_events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: order_events order_events_order_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_order_id_business_id_fkey FOREIGN KEY (order_id, business_id) REFERENCES public.orders(id, business_id) ON DELETE RESTRICT;

--
-- Name: order_items order_items_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: order_items order_items_order_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_business_id_fkey FOREIGN KEY (order_id, business_id) REFERENCES public.orders(id, business_id) ON DELETE RESTRICT;

--
-- Name: order_items order_items_preorder_item_id_business_id_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_preorder_item_id_business_id_product_id_fkey FOREIGN KEY (preorder_item_id, business_id, product_id) REFERENCES public.preorder_items(id, business_id, product_id) ON DELETE RESTRICT;

--
-- Name: order_items order_items_pricing_campaign_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pricing_campaign_id_business_id_fkey FOREIGN KEY (pricing_campaign_id, business_id) REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT;

--
-- Name: order_items order_items_product_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_business_id_fkey FOREIGN KEY (product_id, business_id) REFERENCES public.products(id, business_id) ON DELETE RESTRICT;

--
-- Name: order_production_costs order_production_costs_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_production_costs
    ADD CONSTRAINT order_production_costs_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: order_production_costs order_production_costs_order_item_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_production_costs
    ADD CONSTRAINT order_production_costs_order_item_id_business_id_fkey FOREIGN KEY (order_item_id, business_id) REFERENCES public.order_items(id, business_id) ON DELETE RESTRICT;

--
-- Name: order_production_costs order_production_costs_resolved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_production_costs
    ADD CONSTRAINT order_production_costs_resolved_by_user_id_fkey FOREIGN KEY (resolved_by_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: orders orders_attribution_campaign_id_business_id_preorder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_attribution_campaign_id_business_id_preorder_id_fkey FOREIGN KEY (attribution_campaign_id, business_id, preorder_id) REFERENCES public.campaigns(id, business_id, preorder_id) ON DELETE RESTRICT;

--
-- Name: orders orders_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: orders orders_preorder_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_preorder_id_business_id_fkey FOREIGN KEY (preorder_id, business_id) REFERENCES public.preorders(id, business_id) ON DELETE RESTRICT;

--
-- Name: orders orders_pricing_campaign_id_business_id_preorder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pricing_campaign_id_business_id_preorder_id_fkey FOREIGN KEY (pricing_campaign_id, business_id, preorder_id) REFERENCES public.campaigns(id, business_id, preorder_id) ON DELETE RESTRICT;

--
-- Name: payment_events payment_events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: payment_events payment_events_payment_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_payment_id_business_id_fkey FOREIGN KEY (payment_id, business_id) REFERENCES public.payments(id, business_id) ON DELETE RESTRICT;

--
-- Name: payments payments_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: payments payments_order_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_business_id_fkey FOREIGN KEY (order_id, business_id) REFERENCES public.orders(id, business_id) ON DELETE RESTRICT;

--
-- Name: preorder_items preorder_items_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preorder_items
    ADD CONSTRAINT preorder_items_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: preorder_items preorder_items_capacity_id_business_id_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preorder_items
    ADD CONSTRAINT preorder_items_capacity_id_business_id_product_id_fkey FOREIGN KEY (capacity_id, business_id, product_id) REFERENCES public.production_capacity(id, business_id, product_id) ON DELETE RESTRICT;

--
-- Name: preorder_items preorder_items_preorder_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preorder_items
    ADD CONSTRAINT preorder_items_preorder_id_business_id_fkey FOREIGN KEY (preorder_id, business_id) REFERENCES public.preorders(id, business_id) ON DELETE RESTRICT;

--
-- Name: preorder_items preorder_items_product_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preorder_items
    ADD CONSTRAINT preorder_items_product_id_business_id_fkey FOREIGN KEY (product_id, business_id) REFERENCES public.products(id, business_id) ON DELETE RESTRICT;

--
-- Name: preorders preorders_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preorders
    ADD CONSTRAINT preorders_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: production_capacity production_capacity_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_capacity
    ADD CONSTRAINT production_capacity_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: production_capacity production_capacity_product_id_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_capacity
    ADD CONSTRAINT production_capacity_product_id_business_id_fkey FOREIGN KEY (product_id, business_id) REFERENCES public.products(id, business_id) ON DELETE RESTRICT;

--
-- Name: products products_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

--
-- Name: ai_generations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;

--
-- Name: business_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;

--
-- Name: businesses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

--
-- Name: businesses businesses_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY businesses_owner_update ON public.businesses FOR UPDATE TO authenticated USING (public.is_business_owner(id)) WITH CHECK (public.is_business_owner(id));

--
-- Name: campaign_ai_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_ai_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_ai_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_ai_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_blueprints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_blueprints ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_contents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_contents ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_costs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_costs ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_evaluations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_evaluations ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_memories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_memories ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: capacity_reservations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.capacity_reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: domain_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

--
-- Name: job_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: order_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_production_costs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_production_costs ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_generations owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.ai_generations FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: business_members owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.business_members FOR SELECT TO authenticated USING ((user_id = auth.uid()));

--
-- Name: businesses owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.businesses FOR SELECT TO authenticated USING (public.is_business_owner(id));

--
-- Name: campaign_ai_messages owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.campaign_ai_messages FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: campaign_ai_sessions owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.campaign_ai_sessions FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: campaign_blueprints owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.campaign_blueprints FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: campaign_contents owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.campaign_contents FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: campaign_costs owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.campaign_costs FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: campaign_evaluations owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.campaign_evaluations FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: campaign_memories owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.campaign_memories FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: campaign_tasks owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.campaign_tasks FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: campaigns owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.campaigns FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: capacity_reservations owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.capacity_reservations FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: domain_events owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.domain_events FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: job_runs owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.job_runs FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: order_events owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.order_events FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: order_items owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.order_items FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: order_production_costs owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.order_production_costs FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: orders owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.orders FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: payment_events owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.payment_events FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: payments owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.payments FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: preorder_items owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.preorder_items FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: preorders owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.preorders FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: production_capacity owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.production_capacity FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: products owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read ON public.products FOR SELECT TO authenticated USING (public.is_business_owner(business_id));

--
-- Name: payment_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: preorder_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.preorder_items ENABLE ROW LEVEL SECURITY;

--
-- Name: preorders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.preorders ENABLE ROW LEVEL SECURITY;

--
-- Name: production_capacity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.production_capacity ENABLE ROW LEVEL SECURITY;

--
-- Name: production_capacity production_capacity_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY production_capacity_owner_insert ON public.production_capacity FOR INSERT TO authenticated WITH CHECK (public.is_business_owner(business_id));

--
-- Name: production_capacity production_capacity_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY production_capacity_owner_update ON public.production_capacity FOR UPDATE TO authenticated USING (public.is_business_owner(business_id)) WITH CHECK (public.is_business_owner(business_id));

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products products_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_owner_insert ON public.products FOR INSERT TO authenticated WITH CHECK (public.is_business_owner(business_id));

--
-- Name: products products_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_owner_update ON public.products FOR UPDATE TO authenticated USING (public.is_business_owner(business_id)) WITH CHECK (public.is_business_owner(business_id));

--
-- Name: rate_limit_buckets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

-- =============================================================================
-- Hak akses role API
-- Supabase otomatis memberi anon/authenticated akses ke tabel dan fungsi baru di schema public, jadi semua hak
-- dicabut dulu lalu diberikan ulang persis sesuai kebutuhan aplikasi (termasuk hak tulis per kolom untuk pemilik).
-- =============================================================================

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
REVOKE ALL ON TABLE public.ai_generations FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.ai_generations TO service_role;
GRANT SELECT ON TABLE public.ai_generations TO authenticated;
REVOKE ALL ON TABLE public.business_members FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.business_members TO service_role;
GRANT SELECT ON TABLE public.business_members TO authenticated;
REVOKE ALL ON TABLE public.businesses FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.businesses TO service_role;
GRANT SELECT ON TABLE public.businesses TO authenticated;
REVOKE ALL ON TABLE public.campaign_ai_messages FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.campaign_ai_messages TO service_role;
GRANT SELECT ON TABLE public.campaign_ai_messages TO authenticated;
REVOKE ALL ON TABLE public.campaign_ai_sessions FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.campaign_ai_sessions TO service_role;
GRANT SELECT ON TABLE public.campaign_ai_sessions TO authenticated;
REVOKE ALL ON TABLE public.campaign_blueprints FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.campaign_blueprints TO service_role;
GRANT SELECT ON TABLE public.campaign_blueprints TO authenticated;
REVOKE ALL ON TABLE public.campaign_contents FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.campaign_contents TO service_role;
GRANT SELECT ON TABLE public.campaign_contents TO authenticated;
REVOKE ALL ON TABLE public.campaign_costs FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.campaign_costs TO service_role;
GRANT SELECT ON TABLE public.campaign_costs TO authenticated;
REVOKE ALL ON TABLE public.campaign_evaluations FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.campaign_evaluations TO service_role;
GRANT SELECT ON TABLE public.campaign_evaluations TO authenticated;
REVOKE ALL ON TABLE public.campaign_memories FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.campaign_memories TO service_role;
GRANT SELECT ON TABLE public.campaign_memories TO authenticated;
REVOKE ALL ON TABLE public.campaign_tasks FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.campaign_tasks TO service_role;
GRANT SELECT ON TABLE public.campaign_tasks TO authenticated;
REVOKE ALL ON TABLE public.campaigns FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.campaigns TO service_role;
GRANT SELECT ON TABLE public.campaigns TO authenticated;
REVOKE ALL ON TABLE public.capacity_reservations FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.capacity_reservations TO service_role;
GRANT SELECT ON TABLE public.capacity_reservations TO authenticated;
REVOKE ALL ON TABLE public.domain_events FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.domain_events TO service_role;
GRANT SELECT ON TABLE public.domain_events TO authenticated;
REVOKE ALL ON TABLE public.job_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.job_runs TO service_role;
GRANT SELECT ON TABLE public.job_runs TO authenticated;
REVOKE ALL ON TABLE public.order_events FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.order_events TO service_role;
GRANT SELECT ON TABLE public.order_events TO authenticated;
REVOKE ALL ON TABLE public.order_items FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.order_items TO service_role;
GRANT SELECT ON TABLE public.order_items TO authenticated;
REVOKE ALL ON TABLE public.order_production_costs FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.order_production_costs TO service_role;
GRANT SELECT ON TABLE public.order_production_costs TO authenticated;
REVOKE ALL ON TABLE public.orders FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.orders TO service_role;
GRANT SELECT ON TABLE public.orders TO authenticated;
REVOKE ALL ON TABLE public.payment_events FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.payment_events TO service_role;
GRANT SELECT ON TABLE public.payment_events TO authenticated;
REVOKE ALL ON TABLE public.payments FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.payments TO service_role;
GRANT SELECT ON TABLE public.payments TO authenticated;
REVOKE ALL ON TABLE public.preorder_items FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.preorder_items TO service_role;
GRANT SELECT ON TABLE public.preorder_items TO authenticated;
REVOKE ALL ON TABLE public.preorders FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.preorders TO service_role;
GRANT SELECT ON TABLE public.preorders TO authenticated;
REVOKE ALL ON TABLE public.production_capacity FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.production_capacity TO service_role;
GRANT SELECT ON TABLE public.production_capacity TO authenticated;
REVOKE ALL ON TABLE public.products FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.products TO service_role;
GRANT SELECT ON TABLE public.products TO authenticated;
REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.rate_limit_buckets TO service_role;
GRANT INSERT (business_id, name, sku, description, photo_path, base_price_idr, variable_cost_idr, cost_quality, is_active, gallery_photo_paths) ON TABLE public.products TO authenticated;
GRANT INSERT (business_id, product_id, fulfillment_date, total_units, intake_cutoff_at, fulfillment_window_end_at) ON TABLE public.production_capacity TO authenticated;
GRANT UPDATE (name, description, public_contact, pickup_instructions, categories) ON TABLE public.businesses TO authenticated;
GRANT UPDATE (name, sku, description, photo_path, base_price_idr, variable_cost_idr, cost_quality, is_active, gallery_photo_paths) ON TABLE public.products TO authenticated;
GRANT UPDATE (total_units, intake_cutoff_at, fulfillment_window_end_at) ON TABLE public.production_capacity TO authenticated;
REVOKE ALL ON FUNCTION private.append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.approve_memory_and_enqueue(uuid,uuid,text,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.are_valid_business_categories(text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.are_valid_business_categories(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.are_valid_business_categories(text[]) TO service_role;
REVOKE ALL ON FUNCTION private.assert_orderable(public.production_capacity,public.preorder_items,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.check_context_versions(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.check_evaluation_sources(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.check_memory_source(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.check_order_totals() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.close_active_payment_attempts(public.orders,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.committed_units(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.cost_changed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.current_order_offer(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.current_owner_business() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.discount_per_unit(bigint,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.enqueue_paid_email(public.orders) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.finish_memory_index_job(uuid,uuid,integer,uuid,text,integer,text,text,extensions.vector,text,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_blueprint() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_campaign_completion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_campaign() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_capacity_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_capacity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_evaluation_insert() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_evaluation_source_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_memory_job() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_memory_pipeline() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_memory() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_order_items() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_payment() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_preorder_item() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_preorder() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_reservation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_synthetic_finalization_memory() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.insert_order(public.preorders,public.preorder_items,text,text,text,text,text,text,text,integer,text,text,text,text,timestamp with time zone,integer,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_business_owner(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_business_owner(uuid) TO authenticated;
REVOKE ALL ON FUNCTION private.job_backoff(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.lock_campaign_context(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.lock_order_context(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.lock_order(uuid,integer,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.lock_owned_preorder(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.new_order_number() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.order_result(public.orders,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.owns_product_photo(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.owns_product_photo(text) TO authenticated;
REVOKE ALL ON FUNCTION private.payment_attempt_result(public.payments,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.publish_preorder_canonical(uuid,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.record_order_event(uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.require_owner(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.resolve_attribution(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sync_business_category() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.touch_row() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_late_payment(uuid,integer,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_late_payment(uuid,integer,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admit_ai_generation(uuid,uuid,uuid,text,text,text,text,uuid,uuid,integer,text,text,text,text,text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admit_ai_generation(uuid,uuid,uuid,text,text,text,text,uuid,uuid,integer,text,text,text,text,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.advance_fulfillment(uuid,integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_fulfillment(uuid,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.apply_verified_payment(text,text,text,text,text,bigint,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_verified_payment(text,text,text,text,text,bigint,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.apply_verified_payment(uuid,text,text,text,bigint,text,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_verified_payment(uuid,text,text,text,bigint,text,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.approve_blueprint(uuid,uuid,jsonb,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_blueprint(uuid,uuid,jsonb,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.approve_campaign_memory(uuid,uuid,text,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_campaign_memory(uuid,uuid,text,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_preorder_draft(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_preorder_draft(uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_published_preorder(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_published_preorder(uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_ai_generation(uuid,uuid,integer,text,text,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_generation(uuid,uuid,integer,text,text,text,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_generation(uuid,uuid,integer,text,text,text,text,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_jobs(integer,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_jobs(integer,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_jobs(text[],integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_jobs(text[],integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_memory_jobs(uuid,text,text,integer,integer,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_memory_jobs(uuid,text,text,integer,integer,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_payment_attempt(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_payment_attempt(text) TO service_role;
REVOKE ALL ON FUNCTION public.close_campaign(uuid,uuid,integer,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_campaign(uuid,uuid,integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_campaign(uuid,uuid,integer,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.close_preorder(uuid,integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_preorder(uuid,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_job(uuid,integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_memory_index_job(uuid,uuid,integer,uuid,text,integer,text,text,extensions.vector,text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_memory_index_job(uuid,uuid,integer,uuid,text,integer,text,text,extensions.vector,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.complete_memory_indexing(uuid,text,integer,text,text,extensions.vector) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_preorder(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_preorder(uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.create_ai_session(uuid,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_ai_session(uuid,uuid,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_ai_session(uuid,uuid,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.create_business_with_owner(text,text,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(text,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(text,text,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.create_business_with_owner(text,text,text[],text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(text,text,text[],text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_campaign_with_initial_blueprint(uuid,uuid,uuid,uuid,jsonb,jsonb,text,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_campaign_with_initial_blueprint(uuid,uuid,uuid,uuid,jsonb,jsonb,text,uuid,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.create_manual_order(uuid,integer,text,text,text,boolean,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_manual_order(uuid,integer,text,text,text,boolean,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_preorder_order(text,integer,text,text,text,text,text,text,bigint,integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_preorder_order(text,integer,text,text,text,text,text,text,bigint,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.create_standalone_manual_order(uuid,integer,text,text,text,boolean,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_standalone_manual_order(uuid,integer,text,text,text,boolean,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.decline_late_payment(uuid,integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_late_payment(uuid,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.enqueue_expire_jobs(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_expire_jobs(integer) TO service_role;
REVOKE ALL ON FUNCTION public.expire_or_cancel_order(uuid,integer,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_or_cancel_order(uuid,integer,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_or_cancel_order(uuid,integer,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.fail_ai_generation(uuid,uuid,uuid,integer,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_ai_generation(uuid,uuid,uuid,integer,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fail_job(uuid,integer,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_job(uuid,integer,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_ai_generation(uuid,uuid,uuid,integer,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_ai_generation(uuid,uuid,uuid,integer,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_campaign_evaluation(uuid,uuid,uuid,uuid,uuid,integer,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_campaign_evaluation(uuid,uuid,uuid,uuid,uuid,integer,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.finish_job(uuid,integer,boolean,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finish_job(uuid,integer,boolean,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_business_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_owner(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.match_campaign_memories(uuid,extensions.vector,text,text,integer,integer,double precision) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_campaign_memories(uuid,extensions.vector,text,text,integer,integer,double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_campaign_memories(uuid,extensions.vector,text,text,integer,integer,double precision) TO service_role;
REVOKE ALL ON FUNCTION public.publish_campaign(uuid,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_campaign(uuid,uuid,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.publish_preorder(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_preorder(uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.publish_preorder(uuid,uuid,integer,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_preorder(uuid,uuid,integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_preorder(uuid,uuid,integer,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.read_preorder_offer(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_preorder_offer(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_campaign_evaluation_cas(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,timestamp with time zone,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_campaign_evaluation_cas(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,timestamp with time zone,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_campaign_evaluation(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,timestamp with time zone,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_campaign_evaluation(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,timestamp with time zone,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_payment_charge(uuid,text,text,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_charge(uuid,text,text,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_ai_session_context(uuid,uuid,integer,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_ai_session_context(uuid,uuid,integer,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_ai_session_context(uuid,uuid,integer,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_production_cost(uuid,integer,bigint,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_production_cost(uuid,integer,bigint,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_blueprint_revision(uuid,uuid,integer,uuid,text,jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_blueprint_revision(uuid,uuid,integer,uuid,text,jsonb,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.save_campaign_draft(uuid,uuid,uuid,integer,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_campaign_draft(uuid,uuid,uuid,integer,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.save_preorder_draft(uuid,integer,text,text,uuid,integer,integer,timestamp with time zone,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_preorder_draft(uuid,integer,text,text,uuid,integer,integer,timestamp with time zone,timestamp with time zone) TO authenticated;
REVOKE ALL ON FUNCTION public.take_rate_limit(text,timestamp with time zone,timestamp with time zone,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.take_rate_limit(text,timestamp with time zone,timestamp with time zone,integer) TO service_role;


-- =============================================================================
-- Storage: foto produk
-- Bucket publik; unggah, baca, dan hapus hanya di folder business_id milik pemilik sendiri.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-photos', 'product-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY product_photos_owner_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'product-photos' AND private.owns_product_photo(name));
CREATE POLICY product_photos_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-photos' AND private.owns_product_photo(name));
CREATE POLICY product_photos_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-photos' AND private.owns_product_photo(name));
