-- Sellado de lote (reversible: DROP COLUMN batch_id).
-- No afecta OMR; solo metadato en evaluations.
ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS batch_id uuid NULL;

COMMENT ON COLUMN public.evaluations.batch_id IS
  'UUID de lote generado en el evaluador al iniciar carga; agrupa evaluaciones masivas del mismo curso/prueba.';

CREATE INDEX IF NOT EXISTS evaluations_batch_id_idx
  ON public.evaluations (batch_id)
  WHERE batch_id IS NOT NULL;
