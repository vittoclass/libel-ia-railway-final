-- Rellenar title, subject y course_id en evaluaciones existentes que tengan NULL.
UPDATE public.evaluations SET title = 'Evaluación sin título' WHERE title IS NULL;
UPDATE public.evaluations SET subject = 'Sin asignatura' WHERE subject IS NULL;
UPDATE public.evaluations SET course_id = 'Sin curso' WHERE course_id IS NULL;
