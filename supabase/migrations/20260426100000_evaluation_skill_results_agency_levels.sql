-- Nivel de logro por habilidad (cortes tipo Agencia: <50 Insuficiente, 50–69 Elemental, ≥70 Adecuado).
-- No toca flujo OMR ni tablas de escaneo.

ALTER TABLE public.evaluation_skill_results
  ADD COLUMN IF NOT EXISTS logro_pct smallint NULL,
  ADD COLUMN IF NOT EXISTS achievement_level text NULL;

COMMENT ON COLUMN public.evaluation_skill_results.logro_pct IS 'Porcentaje de logro redondeado 0–100 para la agregación (axis_id, skill_id) del estudiante en la evaluación.';
COMMENT ON COLUMN public.evaluation_skill_results.achievement_level IS 'Nivel de logro según cortes institucionales Chile: Insuficiente, Elemental, Adecuado.';

UPDATE public.evaluation_skill_results r
SET
  logro_pct = CASE
    WHEN COALESCE(r.score_max, 0) > 0 THEN
      LEAST(
        100,
        GREATEST(
          0,
          ROUND((COALESCE(r.score_obtained, 0)::numeric / NULLIF(r.score_max, 0)::numeric) * 100)::integer
        )
      )
    ELSE NULL
  END
WHERE r.logro_pct IS NULL;

UPDATE public.evaluation_skill_results r
SET achievement_level = CASE
  WHEN r.logro_pct IS NULL THEN NULL
  WHEN r.logro_pct < 50 THEN 'Insuficiente'
  WHEN r.logro_pct < 70 THEN 'Elemental'
  ELSE 'Adecuado'
END
WHERE r.achievement_level IS NULL;

NOTIFY pgrst, 'reload schema';
