-- Reparación segura: deja operativas las tablas de pruebas base (source_exams) sin depender de pedagogy_axes.
-- Compatible con la UI y APIs ya creadas. No borra ni altera datos existentes.
-- Si las tablas ya existen (p. ej. por 20260404/20260407), los CREATE IF NOT EXISTS no hacen nada.

-- 1) source_exams: tabla principal de pruebas base / instrumentos en blanco
CREATE TABLE IF NOT EXISTS public.source_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  school_id uuid NULL,
  title text NULL,
  subject text NULL,
  course_label text NULL,
  exam_type text NULL,
  pedagogy_mode text NULL,
  source_file_name text NULL,
  source_text text NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.source_exams ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS source_exams_teacher_id_idx ON public.source_exams (teacher_id);

-- 2) source_exam_items: ítems de cada prueba base (axis_id/skill_id sin FK para no depender de pedagogy_axes)
CREATE TABLE IF NOT EXISTS public.source_exam_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_exam_id uuid NOT NULL REFERENCES public.source_exams(id) ON DELETE CASCADE,
  item_number integer NULL,
  item_text text NULL,
  axis_id uuid NULL,
  skill_id uuid NULL,
  competence text NULL,
  difficulty text NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.source_exam_items ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS source_exam_items_source_exam_id_idx ON public.source_exam_items (source_exam_id);

-- 3) evaluations: columna para vincular evaluación a prueba base (si no existe)
ALTER TABLE public.evaluations ADD COLUMN IF NOT EXISTS source_exam_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'evaluations_source_exam_id_fkey'
    AND table_schema = 'public' AND table_name = 'evaluations'
  ) THEN
    ALTER TABLE public.evaluations
      ADD CONSTRAINT evaluations_source_exam_id_fkey
      FOREIGN KEY (source_exam_id) REFERENCES public.source_exams(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4) Tabla puente evaluación <-> prueba base
CREATE TABLE IF NOT EXISTS public.evaluation_source_exams (
  evaluation_id uuid PRIMARY KEY REFERENCES public.evaluations(id) ON DELETE CASCADE,
  source_exam_id uuid NOT NULL REFERENCES public.source_exams(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evaluation_source_exams_source_exam_id_idx
  ON public.evaluation_source_exams (source_exam_id);

-- 5) Backfill: copiar asociaciones desde evaluations.source_exam_id (idempotente)
INSERT INTO public.evaluation_source_exams (evaluation_id, source_exam_id)
SELECT id, source_exam_id
FROM public.evaluations
WHERE source_exam_id IS NOT NULL
ON CONFLICT (evaluation_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
