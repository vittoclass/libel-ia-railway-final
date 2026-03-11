-- Persistencia estudiantes: student_normalized para agrupar/ordenar (aditivo, no rompe nada).
-- La tabla evaluation_students ya existe; solo añadimos columna e índices si faltan.

-- Columna para ordenar/agrupar (normalizado: trim + lowercase)
ALTER TABLE public.evaluation_students ADD COLUMN IF NOT EXISTS student_normalized text;

-- Backfill desde student_name
UPDATE public.evaluation_students
SET student_normalized = lower(trim(student_name))
WHERE student_name IS NOT NULL AND (student_normalized IS NULL OR student_normalized = '');

-- Índice por evaluación (puede existir con otro nombre)
CREATE INDEX IF NOT EXISTS evaluation_students_eval_idx ON public.evaluation_students (evaluation_id);

-- Índice por curso (usamos course_id_text que ya existe en la app)
CREATE INDEX IF NOT EXISTS evaluation_students_course_idx ON public.evaluation_students (course_id_text, created_at DESC NULLS LAST);

-- Unique por (evaluation_id, student_normalized) para upsert seguro (solo donde hay valor)
CREATE UNIQUE INDEX IF NOT EXISTS evaluation_students_eval_normalized_key
  ON public.evaluation_students (evaluation_id, student_normalized)
  WHERE student_normalized IS NOT NULL AND student_normalized != '';
