-- Memoria nominal docente (observacional, append-only). No toca evaluation_students ni OCR.

BEGIN;

CREATE TABLE IF NOT EXISTS public.graph_nominal_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.teachers (id) ON DELETE CASCADE,
  organization_id uuid NULL,
  course_label text NULL,
  evaluation_id uuid NULL,
  observed_name_raw text NOT NULL,
  observed_name_normalized text NOT NULL,
  confirmed_name text NOT NULL,
  confirmed_name_normalized text NOT NULL,
  confirmation_type text NOT NULL,
  manual_override boolean NOT NULL DEFAULT false,
  exact_match boolean NOT NULL DEFAULT false,
  ignored boolean NOT NULL DEFAULT false,
  source text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graph_nominal_confirmations_type_chk CHECK (
    confirmation_type IN ('exact_match', 'manual_override', 'suggested_match', 'ignored')
  )
);

CREATE INDEX IF NOT EXISTS graph_nominal_confirmations_teacher_id_idx
  ON public.graph_nominal_confirmations (teacher_id);

CREATE INDEX IF NOT EXISTS graph_nominal_confirmations_observed_norm_idx
  ON public.graph_nominal_confirmations (observed_name_normalized);

CREATE INDEX IF NOT EXISTS graph_nominal_confirmations_confirmed_norm_idx
  ON public.graph_nominal_confirmations (confirmed_name_normalized);

CREATE INDEX IF NOT EXISTS graph_nominal_confirmations_course_label_idx
  ON public.graph_nominal_confirmations (course_label);

CREATE INDEX IF NOT EXISTS graph_nominal_confirmations_created_at_idx
  ON public.graph_nominal_confirmations (created_at DESC);

CREATE INDEX IF NOT EXISTS graph_nominal_confirmations_dedupe_idx
  ON public.graph_nominal_confirmations (
    teacher_id,
    observed_name_normalized,
    confirmed_name_normalized,
    confirmation_type
  );

COMMENT ON TABLE public.graph_nominal_confirmations IS
  'Memoria nominal docente: OCR observado → nombre confirmado (exact_match, manual_override, suggested_match, ignored).';

ALTER TABLE public.graph_nominal_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS graph_nominal_confirmations_select_teacher ON public.graph_nominal_confirmations;
CREATE POLICY graph_nominal_confirmations_select_teacher
  ON public.graph_nominal_confirmations
  FOR SELECT
  TO authenticated
  USING (
    teacher_id = (
      SELECT p.teacher_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS graph_nominal_confirmations_insert_teacher ON public.graph_nominal_confirmations;
CREATE POLICY graph_nominal_confirmations_insert_teacher
  ON public.graph_nominal_confirmations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    teacher_id = (
      SELECT p.teacher_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
