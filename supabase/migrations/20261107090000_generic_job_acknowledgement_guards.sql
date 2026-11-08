-- PM07: preserve RPC contracts/ACLs; Memory acknowledgement belongs to its atomic indexing RPC.
BEGIN;

CREATE OR REPLACE FUNCTION public.complete_job(p_job_id uuid, p_attempt integer, p_provider_reference text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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

CREATE OR REPLACE FUNCTION public.fail_job(p_job_id uuid, p_attempt integer, p_error_code text, p_provider_reference text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;

COMMIT;
