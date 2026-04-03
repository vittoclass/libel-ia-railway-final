-- PASO C — Metadatos de agrupación por alumno/página (buzón hacia PC / futuro Evaluar).
-- Aditivo y reversible: ALTER DROP COLUMN.
-- No toca evaluations ni OMR.

BEGIN;

ALTER TABLE public.batch_photo_uploads
  ADD COLUMN IF NOT EXISTS student_index integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS page_index integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.batch_photo_uploads.student_index IS
  'Orden del estudiante dentro del lote (1-based), alineado a carillas móviles.';

COMMENT ON COLUMN public.batch_photo_uploads.page_index IS
  'Foto dentro del estudiante (1..N según imágenes por estudiante).';

CREATE INDEX IF NOT EXISTS batch_photo_uploads_batch_student_page_idx
  ON public.batch_photo_uploads (batch_id, student_index, page_index);

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Reversión manual:
-- DROP INDEX IF EXISTS batch_photo_uploads_batch_student_page_idx;
-- ALTER TABLE public.batch_photo_uploads DROP COLUMN IF EXISTS page_index;
-- ALTER TABLE public.batch_photo_uploads DROP COLUMN IF EXISTS student_index;
