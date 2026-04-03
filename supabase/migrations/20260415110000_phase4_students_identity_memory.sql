-- PHASE_4_MEMORY_IDENTITY_V1
-- Migracion aditiva, reversible y no destructiva.

BEGIN;

CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rut_raw text NULL,
  rut_norm text NOT NULL,
  full_name text NOT NULL,
  course_label text NULL,
  institution text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS students_rut_norm_uidx
  ON public.students (rut_norm);

CREATE INDEX IF NOT EXISTS students_full_name_idx
  ON public.students (full_name);

CREATE OR REPLACE FUNCTION public.set_students_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS students_updated_at ON public.students;
CREATE TRIGGER students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.set_students_updated_at();

CREATE TABLE IF NOT EXISTS public.student_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  evaluation_id uuid NOT NULL REFERENCES public.evaluations(id) ON DELETE CASCADE,
  course_label text NULL,
  evaluated_at timestamptz NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS student_evaluations_evaluation_uidx
  ON public.student_evaluations (evaluation_id);

CREATE INDEX IF NOT EXISTS student_evaluations_student_date_idx
  ON public.student_evaluations (student_id, evaluated_at DESC NULLS LAST);

ALTER TABLE public.evaluation_students
  ADD COLUMN IF NOT EXISTS student_id uuid NULL REFERENCES public.students(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS evaluation_students_student_id_idx
  ON public.evaluation_students (student_id);

ALTER TABLE public.evaluation_skill_results
  ADD COLUMN IF NOT EXISTS student_id uuid NULL REFERENCES public.students(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS evaluation_skill_results_student_id_idx
  ON public.evaluation_skill_results (student_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
