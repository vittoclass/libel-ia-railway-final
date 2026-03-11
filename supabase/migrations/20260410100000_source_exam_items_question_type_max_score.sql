-- Columnas aditivas para ítems de prueba base: tipo de pregunta, respuesta correcta, puntaje máximo, rúbrica.
-- No modifica ni elimina columnas existentes. No altera datos existentes.

ALTER TABLE public.source_exam_items ADD COLUMN IF NOT EXISTS question_type text NULL;
ALTER TABLE public.source_exam_items ADD COLUMN IF NOT EXISTS correct_answer text NULL;
ALTER TABLE public.source_exam_items ADD COLUMN IF NOT EXISTS max_score integer NULL;
ALTER TABLE public.source_exam_items ADD COLUMN IF NOT EXISTS rubric_text text NULL;

NOTIFY pgrst, 'reload schema';
