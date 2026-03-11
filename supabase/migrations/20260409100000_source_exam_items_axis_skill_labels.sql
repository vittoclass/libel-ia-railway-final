-- Columnas opcionales para etiquetas de eje/habilidad en texto (importación masiva).
-- No modifica datos existentes. ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.source_exam_items ADD COLUMN IF NOT EXISTS axis_label text NULL;
ALTER TABLE public.source_exam_items ADD COLUMN IF NOT EXISTS skill_label text NULL;

NOTIFY pgrst, 'reload schema';
