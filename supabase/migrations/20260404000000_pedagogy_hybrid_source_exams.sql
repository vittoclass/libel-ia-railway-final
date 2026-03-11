-- Sistema híbrido pedagógico: pruebas base, modo estructurado (SIMCE/PAES), modo texto.
-- Solo tablas/columnas nuevas. No modifica destructivamente.

-- A) source_exams: pruebas base / pruebas en blanco
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

CREATE INDEX IF NOT EXISTS source_exams_teacher_id_idx ON public.source_exams (teacher_id);

-- B) source_exam_items: ítems de la prueba base
CREATE TABLE IF NOT EXISTS public.source_exam_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_exam_id uuid NOT NULL REFERENCES public.source_exams(id) ON DELETE CASCADE,
  item_number integer NULL,
  item_text text NULL,
  axis_id uuid NULL REFERENCES public.pedagogy_axes(id) ON DELETE SET NULL,
  skill_id uuid NULL REFERENCES public.pedagogy_skills(id) ON DELETE SET NULL,
  competence text NULL,
  difficulty text NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_exam_items_source_exam_id_idx ON public.source_exam_items (source_exam_id);

-- C) evaluations: columnas aditivas para modo pedagógico
ALTER TABLE public.evaluations ADD COLUMN IF NOT EXISTS source_exam_id uuid NULL;
ALTER TABLE public.evaluations ADD COLUMN IF NOT EXISTS pedagogy_mode text NULL;
ALTER TABLE public.evaluations ADD COLUMN IF NOT EXISTS exam_type text NULL;

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

NOTIFY pgrst, 'reload schema';
