-- One committed claim and three business-wide allowances, or none.
BEGIN;

CREATE FUNCTION public.admit_ai_generation(
 p_business_id uuid, p_actor_user_id uuid, p_generation_id uuid, p_generation_type text,
 p_request_key text, p_input_hash text, p_model_id text, p_preorder_id uuid,
 p_session_id uuid, p_expected_version integer, p_context_hash text, p_message text,
 p_minute_key_hash text, p_hour_key_hash text, p_day_key_hash text, p_daily_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;

REVOKE ALL ON FUNCTION public.admit_ai_generation(uuid,uuid,uuid,text,text,text,text,uuid,uuid,integer,text,text,text,text,text,integer)
 FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admit_ai_generation(uuid,uuid,uuid,text,text,text,text,uuid,uuid,integer,text,text,text,text,text,integer)
 TO service_role;

COMMIT;
