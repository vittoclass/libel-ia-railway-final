-- Embudo calidad institucional: Profesor → UTP → Dirección.
-- Solo lotes con status = validated alimentan rollups de trazabilidad (skill_rollup_*).

CREATE TABLE IF NOT EXISTS public.evaluation_batch_institutional_release (
  batch_id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_utp', 'rejected', 'validated')),
  submitted_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  submitted_at timestamptz NULL,
  reviewed_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  utp_observations text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evaluation_batch_institutional_release_school_status_idx
  ON public.evaluation_batch_institutional_release (school_id, status);

COMMENT ON TABLE public.evaluation_batch_institutional_release IS
  'Estado de liberación hacia trazabilidad institucional (Dirección). Sin validated, los rollups por lote no cuentan para KPIs de trazabilidad.';

-- Retrocompatibilidad: lotes ya existentes quedan como validated para no vaciar dashboards actuales.
INSERT INTO public.evaluation_batch_institutional_release (batch_id, school_id, status, submitted_at, reviewed_at, updated_at)
SELECT DISTINCT ON (e.batch_id)
  e.batch_id,
  e.school_id,
  'validated',
  now(),
  now(),
  now()
FROM public.evaluations e
WHERE e.batch_id IS NOT NULL
  AND e.school_id IS NOT NULL
ORDER BY e.batch_id, e.evaluated_at DESC NULLS LAST
ON CONFLICT (batch_id) DO NOTHING;
