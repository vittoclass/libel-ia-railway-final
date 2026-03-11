-- FASE 7A: solo columnas pedagógicas en evaluations (mínimo).
-- pedagogy_mode: 'auto' | 'text' | 'structured'
-- exam_type: 'normal' | 'simce' | 'paes'
-- No crea source_exams ni source_exam_items.

ALTER TABLE public.evaluations ADD COLUMN IF NOT EXISTS pedagogy_mode text NULL;
ALTER TABLE public.evaluations ADD COLUMN IF NOT EXISTS exam_type text NULL;

NOTIFY pgrst, 'reload schema';
