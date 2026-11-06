-- Batch 03B: permit durable Memory generation claims without changing other lifecycle contracts.
BEGIN;

ALTER TABLE public.ai_generations
  DROP CONSTRAINT ai_generations_generation_type_check;
ALTER TABLE public.ai_generations
  ADD CONSTRAINT ai_generations_generation_type_check
  CHECK (generation_type IN ('strategies','discussion','blueprint','evaluation','memory'));

COMMIT;
