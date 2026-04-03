-- Puente lote móvil → evaluations: metadatos de sesión, fotos y filas de evaluación.
-- Idempotente. Relaja NOT NULL en columnas nuevas para no bloquear flujos parciales.

BEGIN;

-- Sesión de escaneo: páginas esperadas por alumno (PC) y pauta opcional
ALTER TABLE public.batch_scan_sessions
  ADD COLUMN IF NOT EXISTS expected_pages_per_student integer DEFAULT 2;

ALTER TABLE public.batch_scan_sessions
  ADD COLUMN IF NOT EXISTS source_exam_id uuid NULL;

ALTER TABLE public.batch_scan_sessions ALTER COLUMN expected_pages_per_student DROP NOT NULL;
COMMENT ON COLUMN public.batch_scan_sessions.expected_pages_per_student IS
  'Número de fotos (page_index distintas) requeridas por alumno antes de promover a evaluations.';
COMMENT ON COLUMN public.batch_scan_sessions.source_exam_id IS
  'Pauta elegida en la estación PC para contextualizar evaluaciones generadas desde el lote.';

UPDATE public.batch_scan_sessions
SET expected_pages_per_student = COALESCE(expected_pages_per_student, 2)
WHERE expected_pages_per_student IS NULL;

-- Cola de fotos: vínculo a evaluación y estado
ALTER TABLE public.batch_photo_uploads
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';

ALTER TABLE public.batch_photo_uploads
  ADD COLUMN IF NOT EXISTS evaluation_id uuid NULL REFERENCES public.evaluations (id) ON DELETE SET NULL;

ALTER TABLE public.batch_photo_uploads
  ADD COLUMN IF NOT EXISTS processing_error text NULL;

ALTER TABLE public.batch_photo_uploads
  ADD COLUMN IF NOT EXISTS score numeric NULL;

ALTER TABLE public.batch_photo_uploads ALTER COLUMN status DROP NOT NULL;
ALTER TABLE public.batch_photo_uploads ALTER COLUMN evaluation_id DROP NOT NULL;
ALTER TABLE public.batch_photo_uploads ALTER COLUMN processing_error DROP NOT NULL;
ALTER TABLE public.batch_photo_uploads ALTER COLUMN score DROP NOT NULL;

CREATE INDEX IF NOT EXISTS batch_photo_uploads_evaluation_id_idx
  ON public.batch_photo_uploads (evaluation_id)
  WHERE evaluation_id IS NOT NULL;

COMMENT ON COLUMN public.batch_photo_uploads.status IS
  'pending | linked | error — linked tras crear evaluation.';
COMMENT ON COLUMN public.batch_photo_uploads.evaluation_id IS
  'Evaluación creada desde este lote para este alumno (slot).';

-- Evaluaciones: registro generado desde escaneo por lote
ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS batch_student_index integer NULL;

ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS scan_image_paths jsonb NULL;

ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS capture_source text DEFAULT 'manual';

ALTER TABLE public.evaluations ALTER COLUMN batch_student_index DROP NOT NULL;
ALTER TABLE public.evaluations ALTER COLUMN scan_image_paths DROP NOT NULL;
ALTER TABLE public.evaluations ALTER COLUMN capture_source DROP NOT NULL;

COMMENT ON COLUMN public.evaluations.batch_student_index IS
  'Índice de alumno en el lote (1-based), alineado con batch_photo_uploads.student_index.';
COMMENT ON COLUMN public.evaluations.scan_image_paths IS
  'Rutas en Storage (bucket batch-scans), ordenadas por page_index.';
COMMENT ON COLUMN public.evaluations.capture_source IS
  'manual | batch_scan — origen del registro.';

-- Un solo registro de evaluación por (lote, slot alumno) cuando ambos están definidos
CREATE UNIQUE INDEX IF NOT EXISTS evaluations_batch_student_slot_unique
  ON public.evaluations (batch_id, batch_student_index)
  WHERE batch_id IS NOT NULL AND batch_student_index IS NOT NULL;

-- Nota: la tabla public.students (identidad alumno) no interviene en este flujo;
-- los slots del lote se reflejan en evaluation_students.student_name y batch_student_index.

NOTIFY pgrst, 'reload schema';

COMMIT;
