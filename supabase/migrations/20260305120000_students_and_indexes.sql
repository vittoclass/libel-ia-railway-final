-- Carpetas por curso + guardado persistente nombre/curso.
-- Idempotente: IF NOT EXISTS en todo. No rompe producción.

-- A) evaluations: student_name (single-student); course_id ya existe como text en uso app
ALTER TABLE public.evaluations ADD COLUMN IF NOT EXISTS student_name text;

-- Índice para listar por teacher + course + fecha
CREATE INDEX IF NOT EXISTS evaluations_teacher_course_idx ON public.evaluations (teacher_id, course_id, evaluated_at DESC NULLS LAST);

-- B) evaluation_students: curso como text para consultas (duplicado intencional)
-- La tabla ya puede existir con course_id uuid; añadimos course_id_text para filtro por string
ALTER TABLE public.evaluation_students ADD COLUMN IF NOT EXISTS course_id_text text;

-- Índice por course_id_text para listar por curso
CREATE INDEX IF NOT EXISTS evaluation_students_course_idx ON public.evaluation_students (course_id_text, created_at DESC NULLS LAST);

-- Unique: una fila por (evaluation_id, student_name) cuando student_name está definido
CREATE UNIQUE INDEX IF NOT EXISTS evaluation_students_eval_student_key
  ON public.evaluation_students (evaluation_id, student_name)
  WHERE student_name IS NOT NULL;
