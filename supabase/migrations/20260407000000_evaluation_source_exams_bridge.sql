-- Tabla puente: asociación explícita evaluación <-> prueba base (source_exam).
-- Capa aditiva: no reemplaza evaluations.source_exam_id; se mantiene por compatibilidad.
-- Una evaluación tiene como máximo una prueba base asociada.
-- NO mezcla documentos: source_exam = instrumento en blanco; evaluation = prueba respondida del estudiante.

CREATE TABLE IF NOT EXISTS public.evaluation_source_exams (
  evaluation_id uuid PRIMARY KEY REFERENCES public.evaluations(id) ON DELETE CASCADE,
  source_exam_id uuid NOT NULL REFERENCES public.source_exams(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evaluation_source_exams_source_exam_id_idx
  ON public.evaluation_source_exams (source_exam_id);

COMMENT ON TABLE public.evaluation_source_exams IS
  'Asociación segura evaluación -> prueba base. Fuente alternativa a evaluations.source_exam_id.';

-- Backfill: copiar asociaciones existentes desde evaluations.source_exam_id
-- para que la tabla puente quede consistente con datos históricos.
INSERT INTO public.evaluation_source_exams (evaluation_id, source_exam_id)
SELECT id, source_exam_id
FROM public.evaluations
WHERE source_exam_id IS NOT NULL
ON CONFLICT (evaluation_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
