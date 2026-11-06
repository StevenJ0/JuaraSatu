-- Existing memory approval checks only evaluation_kind; simulated completion must remain isolated.
CREATE FUNCTION private.guard_synthetic_finalization_memory() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.review_status='approved' AND EXISTS(SELECT 1 FROM public.campaign_evaluations e
  WHERE e.id=NEW.source_evaluation_id AND e.metrics_json#>>'{finalization,mode}'='development_synthetic') THEN
  RAISE EXCEPTION 'SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER synthetic_finalization_guard BEFORE INSERT OR UPDATE ON public.campaign_memories
 FOR EACH ROW EXECUTE FUNCTION private.guard_synthetic_finalization_memory();
REVOKE ALL ON FUNCTION private.guard_synthetic_finalization_memory() FROM PUBLIC,anon,authenticated,service_role;
