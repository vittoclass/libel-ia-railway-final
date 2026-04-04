-- Número de preguntas de alternativa (OMR) que el profesor declara para el instrumento.
-- Si es NULL, /api/evaluate cuenta ítems cerrados desde source_exam_items.
ALTER TABLE public.source_exams
  ADD COLUMN IF NOT EXISTS total_questions integer NULL;

COMMENT ON COLUMN public.source_exams.total_questions IS
  'Total de preguntas de marcas/alternativas del examen; alimenta el mapa OMR (rejilla) antes del motor. NULL = inferir desde ítems cerrados.';

NOTIFY pgrst, 'reload schema';
