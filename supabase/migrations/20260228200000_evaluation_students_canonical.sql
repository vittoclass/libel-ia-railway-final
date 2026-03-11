-- Tabla evaluation_students: especificación canónica (aditivo, no destructivo).
-- Si la tabla ya existe (p. ej. desde 20250602), solo se añaden columnas/índices faltantes.
-- Si no existe, se crea con esta estructura.

-- Crear tabla solo cuando no exista (nuevas instalaciones)
CREATE TABLE IF NOT EXISTS public.evaluation_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES public.evaluations(id) ON DELETE CASCADE,
  student_name text NOT NULL DEFAULT '',
  student_normalized text NOT NULL DEFAULT '',
  course_id text NULL,
  created_at timestamptz DEFAULT now()
);

-- Para tablas existentes: añadir columna si falta (no rompe; course_id puede ser uuid en tablas antiguas)
ALTER TABLE public.evaluation_students ADD COLUMN IF NOT EXISTS student_normalized text;

-- Backfill student_normalized desde student_name donde aplique
UPDATE public.evaluation_students
SET student_normalized = lower(trim(student_name))
WHERE student_name IS NOT NULL AND (student_name <> '')
  AND (student_normalized IS NULL OR student_normalized = '');

-- Unique: una fila por (evaluation_id, student_normalized) cuando hay valor
CREATE UNIQUE INDEX IF NOT EXISTS evaluation_students_eval_normalized_uk
  ON public.evaluation_students (evaluation_id, student_normalized)
  WHERE student_normalized IS NOT NULL AND student_normalized <> '';

-- Índices para listado y filtros
CREATE INDEX IF NOT EXISTS evaluation_students_eval_idx ON public.evaluation_students (evaluation_id);
CREATE INDEX IF NOT EXISTS evaluation_students_course_idx ON public.evaluation_students (course_id);
