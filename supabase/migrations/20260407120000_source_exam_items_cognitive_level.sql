-- Nivel cognitivo declarado por el usuario (texto libre); la inferencia solo aplica si queda vacío.
ALTER TABLE public.source_exam_items ADD COLUMN IF NOT EXISTS cognitive_level text NULL;
