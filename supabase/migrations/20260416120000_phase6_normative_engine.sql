-- PHASE_6_NORMATIVE_ENGINE_V1
-- Motor de datos normativos (Agencia + DEMRE) con aislamiento por organization_id.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid NULL;

CREATE INDEX IF NOT EXISTS profiles_organization_id_idx
  ON public.profiles (organization_id);

CREATE TABLE IF NOT EXISTS public.pedagogical_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NULL,
  parameter_type text NOT NULL CHECK (
    parameter_type IN ('AGENCY_LEVEL_CUTS', 'DEMRE_PAES_TABLE', 'SIMCE_PROJECTION_RULE')
  ),
  parameter_key text NOT NULL,
  year integer NOT NULL,
  grade_level text NULL,
  subject text NULL,
  exam_name text NULL,
  application text NULL,
  parameter_payload jsonb NOT NULL,
  source_org text NOT NULL,
  source_url text NOT NULL,
  source_document text NULL,
  source_version text NULL,
  checksum_sha256 text NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pedagogical_parameters_key_year_org_uidx
  ON public.pedagogical_parameters (parameter_key, year, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS pedagogical_parameters_lookup_idx
  ON public.pedagogical_parameters (parameter_type, year, is_active);

DROP TRIGGER IF EXISTS pedagogical_parameters_updated_at ON public.pedagogical_parameters;
CREATE TRIGGER pedagogical_parameters_updated_at
  BEFORE UPDATE ON public.pedagogical_parameters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.student_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  evaluation_id uuid NOT NULL REFERENCES public.evaluations(id) ON DELETE CASCADE,
  course_id uuid NULL REFERENCES public.courses(id) ON DELETE SET NULL,
  logro_pct numeric(5,2) NULL,
  correct_answers integer NULL,
  total_items integer NULL,
  simce_estimated numeric(6,2) NULL,
  simce_band_min numeric(6,2) NULL,
  simce_band_max numeric(6,2) NULL,
  simce_level_label text NULL CHECK (
    simce_level_label IN ('INSUFICIENTE','ELEMENTAL','ADECUADO','NO_PARAMETRIZADO')
  ),
  paes_estimated integer NULL,
  paes_test_type text NULL,
  paes_application text NULL,
  risk_score numeric(5,2) NULL,
  risk_level text NULL CHECK (risk_level IN ('BAJO','MEDIO','ALTO','CRITICO')),
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  skills_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  axis_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  parameters_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, evaluation_id)
);

CREATE INDEX IF NOT EXISTS student_projections_eval_idx
  ON public.student_projections (evaluation_id);

CREATE INDEX IF NOT EXISTS student_projections_org_risk_idx
  ON public.student_projections (organization_id, risk_level, calculated_at DESC);

DROP TRIGGER IF EXISTS student_projections_updated_at ON public.student_projections;
CREATE TRIGGER student_projections_updated_at
  BEFORE UPDATE ON public.student_projections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.current_scope_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(p.organization_id, p.school_id, p.teacher_id)
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1
$$;

ALTER TABLE public.pedagogical_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_projections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pedagogical_parameters_select_policy ON public.pedagogical_parameters;
CREATE POLICY pedagogical_parameters_select_policy
  ON public.pedagogical_parameters
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id = public.current_scope_org_id()
  );

DROP POLICY IF EXISTS pedagogical_parameters_write_policy ON public.pedagogical_parameters;
CREATE POLICY pedagogical_parameters_write_policy
  ON public.pedagogical_parameters
  FOR ALL
  USING (
    organization_id IS NULL
    OR organization_id = public.current_scope_org_id()
  )
  WITH CHECK (
    organization_id IS NULL
    OR organization_id = public.current_scope_org_id()
  );

DROP POLICY IF EXISTS student_projections_select_policy ON public.student_projections;
CREATE POLICY student_projections_select_policy
  ON public.student_projections
  FOR SELECT
  USING (organization_id = public.current_scope_org_id());

DROP POLICY IF EXISTS student_projections_write_policy ON public.student_projections;
CREATE POLICY student_projections_write_policy
  ON public.student_projections
  FOR ALL
  USING (organization_id = public.current_scope_org_id())
  WITH CHECK (organization_id = public.current_scope_org_id());

NOTIFY pgrst, 'reload schema';

COMMIT;
