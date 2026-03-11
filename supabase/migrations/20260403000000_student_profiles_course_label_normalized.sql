-- course_label_normalized para comparación consistente (diagnóstico por curso, búsqueda de perfiles).
-- Solo columnas nuevas. No modifica datos existentes salvo backfill.

ALTER TABLE public.student_profiles
  ADD COLUMN IF NOT EXISTS course_label_normalized text;

-- Backfill: lower(trim(course_label)), vacío -> 'sin curso'
UPDATE public.student_profiles
SET course_label_normalized = CASE
  WHEN course_label IS NULL OR trim(course_label) = '' THEN 'sin curso'
  ELSE lower(trim(regexp_replace(trim(course_label), '\s+', ' ', 'g')))
END
WHERE course_label_normalized IS NULL;

CREATE INDEX IF NOT EXISTS student_profiles_course_label_normalized_idx
  ON public.student_profiles (course_label_normalized);

NOTIFY pgrst, 'reload schema';
