-- course_label en evaluations (texto visible, sin FK).
-- evaluation_students con course_label.
-- course_id en evaluations sigue siendo FK a courses.id (uuid); no guardar texto ahí.

ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS course_label text;

ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS evaluations_user_id_idx
  ON public.evaluations (user_id);

CREATE INDEX IF NOT EXISTS evaluations_course_label_idx
  ON public.evaluations (course_label);

CREATE TABLE IF NOT EXISTS public.evaluation_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES public.evaluations(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  student_normalized text NOT NULL,
  course_label text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS evaluation_students_eval_student_norm_uidx
  ON public.evaluation_students (evaluation_id, student_normalized);

CREATE INDEX IF NOT EXISTS evaluation_students_eval_idx
  ON public.evaluation_students (evaluation_id);

CREATE INDEX IF NOT EXISTS evaluation_students_course_label_idx
  ON public.evaluation_students (course_label);

NOTIFY pgrst, 'reload schema';
