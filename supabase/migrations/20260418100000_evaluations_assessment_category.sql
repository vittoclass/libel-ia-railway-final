-- Clasificación institucional opcional por evaluación (trazabilidad alumno × tipo de prueba).
-- No la rellena el flujo OMR; solo escritura vía vínculo UTP (dashboard).
ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS assessment_category text NULL;

COMMENT ON COLUMN public.evaluations.assessment_category IS
  'Tipo plano de prueba: MENSUAL, LIBRO, SEMESTRAL, ENSAYO_SIMCE, ENSAYO_PAES. NULL si no vinculada por UTP.';

CREATE INDEX IF NOT EXISTS evaluations_assessment_category_idx
  ON public.evaluations (assessment_category)
  WHERE assessment_category IS NOT NULL;
