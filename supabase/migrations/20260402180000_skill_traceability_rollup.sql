-- Rollup de trazabilidad evolutiva (reversible: DROP TABLES).
-- Lectura acelerada para KPI Curso/Colegio por habilidad. No toca OMR ni evaluation_items.
CREATE TABLE IF NOT EXISTS public.skill_rollup_by_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  subject text NOT NULL,
  skill_id uuid NOT NULL REFERENCES public.pedagogy_skills(id) ON DELETE CASCADE,
  axis_id uuid NULL REFERENCES public.pedagogy_axes(id) ON DELETE SET NULL,
  accuracy_avg_pct numeric NOT NULL,
  student_count int NOT NULL DEFAULT 0,
  evaluation_count int NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_rollup_by_batch_uidx
  ON public.skill_rollup_by_batch (batch_id, skill_id, COALESCE(axis_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS skill_rollup_by_batch_school_subject_idx
  ON public.skill_rollup_by_batch (school_id, subject);

CREATE INDEX IF NOT EXISTS skill_rollup_by_batch_computed_at_idx
  ON public.skill_rollup_by_batch (computed_at DESC);

COMMENT ON TABLE public.skill_rollup_by_batch IS
  'Promedio de accuracy (%) por lote (batch_id) y habilidad; alumnos con dato en evaluation_skill_results.';

CREATE TABLE IF NOT EXISTS public.skill_rollup_school_semester (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  subject text NOT NULL,
  semester_key text NOT NULL,
  skill_id uuid NOT NULL REFERENCES public.pedagogy_skills(id) ON DELETE CASCADE,
  axis_id uuid NULL REFERENCES public.pedagogy_axes(id) ON DELETE SET NULL,
  accuracy_avg_pct numeric NOT NULL,
  batch_count int NOT NULL DEFAULT 0,
  student_count int NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_rollup_school_semester_uidx
  ON public.skill_rollup_school_semester (school_id, subject, semester_key, skill_id, COALESCE(axis_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS skill_rollup_school_semester_lookup_idx
  ON public.skill_rollup_school_semester (school_id, subject, semester_key);

COMMENT ON TABLE public.skill_rollup_school_semester IS
  'Promedio de accuracy (%) entre lotes (batch) del colegio, misma asignatura y semestre calendario H1/H2.';
