-- Historial del estudiante: perfiles consolidados, vínculo con evaluation_students, resultados por habilidad.
-- Solo crea tablas/columnas nuevas. No modifica destructivamente.

-- 1) Tabla student_profiles: consolidar estudiantes por profesor/curso
CREATE TABLE IF NOT EXISTS public.student_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  school_id uuid NULL,
  student_name text NOT NULL,
  student_normalized text NOT NULL,
  course_label text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS student_profiles_teacher_student_course_uidx
  ON public.student_profiles (teacher_id, student_normalized, COALESCE(course_label, ''));

CREATE INDEX IF NOT EXISTS student_profiles_teacher_id_idx ON public.student_profiles (teacher_id);
CREATE INDEX IF NOT EXISTS student_profiles_course_label_idx ON public.student_profiles (course_label);

-- 2) evaluation_students: vínculo al perfil histórico
ALTER TABLE public.evaluation_students
  ADD COLUMN IF NOT EXISTS student_profile_id uuid NULL REFERENCES public.student_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS evaluation_students_profile_id_idx ON public.evaluation_students (student_profile_id);

-- 3) pedagogy_axes: agregar axis_code si no existe (estructura existente usa "name")
ALTER TABLE public.pedagogy_axes ADD COLUMN IF NOT EXISTS axis_code text NULL;

-- 4) pedagogy_skills: agregar skill_code si no existe
ALTER TABLE public.pedagogy_skills ADD COLUMN IF NOT EXISTS skill_code text NULL;

-- 5) Tabla evaluation_skill_results: resultados por estudiante y habilidad por evaluación
CREATE TABLE IF NOT EXISTS public.evaluation_skill_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES public.evaluations(id) ON DELETE CASCADE,
  student_profile_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  axis_id uuid NULL REFERENCES public.pedagogy_axes(id) ON DELETE SET NULL,
  skill_id uuid NULL REFERENCES public.pedagogy_skills(id) ON DELETE SET NULL,
  score_obtained numeric NULL,
  score_max numeric NULL,
  accuracy numeric NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evaluation_skill_results_student_profile_id_idx ON public.evaluation_skill_results (student_profile_id);
CREATE INDEX IF NOT EXISTS evaluation_skill_results_evaluation_id_idx ON public.evaluation_skill_results (evaluation_id);
CREATE INDEX IF NOT EXISTS evaluation_skill_results_skill_id_idx ON public.evaluation_skill_results (skill_id);

-- Trigger updated_at para student_profiles
CREATE OR REPLACE FUNCTION set_student_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS student_profiles_updated_at ON public.student_profiles;
CREATE TRIGGER student_profiles_updated_at
  BEFORE UPDATE ON public.student_profiles
  FOR EACH ROW EXECUTE FUNCTION set_student_profiles_updated_at();

NOTIFY pgrst, 'reload schema';
