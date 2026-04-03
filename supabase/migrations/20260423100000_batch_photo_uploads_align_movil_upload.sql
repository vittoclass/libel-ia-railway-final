-- =============================================================================
-- Alineación batch_photo_uploads ↔ app/api/docente/movil-upload/route.ts
--
-- El móvil NO inserta JSON en esta tabla: hace POST multipart con:
--   batch_id, student_index, page_index, file
-- El servidor valida el lote, sube a Storage y ejecuta .insert() con:
--   {
--     batch_id: uuid (string),
--     school_id: uuid,
--     teacher_id: uuid,
--     storage_path: text,
--     content_type: text | null,
--     file_size: number → bigint,
--     created_by: null,
--     student_index: integer,
--     page_index: integer
--   }
-- =============================================================================

BEGIN;

-- Tabla base si no existe (mínimo viable)
CREATE TABLE IF NOT EXISTS public.batch_photo_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Columnas que el código del servidor puede escribir (idempotente)
ALTER TABLE public.batch_photo_uploads ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE public.batch_photo_uploads ADD COLUMN IF NOT EXISTS school_id uuid;
ALTER TABLE public.batch_photo_uploads ADD COLUMN IF NOT EXISTS teacher_id uuid;
ALTER TABLE public.batch_photo_uploads ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE public.batch_photo_uploads ADD COLUMN IF NOT EXISTS content_type text;
ALTER TABLE public.batch_photo_uploads ADD COLUMN IF NOT EXISTS file_size bigint;
ALTER TABLE public.batch_photo_uploads ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.batch_photo_uploads ADD COLUMN IF NOT EXISTS processed_at timestamptz;
ALTER TABLE public.batch_photo_uploads ADD COLUMN IF NOT EXISTS student_index integer;
ALTER TABLE public.batch_photo_uploads ADD COLUMN IF NOT EXISTS page_index integer;

-- Valores por defecto para filas antiguas sin índices (antes de relajar NOT NULL)
UPDATE public.batch_photo_uploads SET student_index = 1 WHERE student_index IS NULL;
UPDATE public.batch_photo_uploads SET page_index = 1 WHERE page_index IS NULL;

-- Quitar NOT NULL para que nunca falle el insert por “dato faltante” en columnas opcionales
ALTER TABLE public.batch_photo_uploads ALTER COLUMN batch_id DROP NOT NULL;
ALTER TABLE public.batch_photo_uploads ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE public.batch_photo_uploads ALTER COLUMN teacher_id DROP NOT NULL;
ALTER TABLE public.batch_photo_uploads ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE public.batch_photo_uploads ALTER COLUMN student_index DROP NOT NULL;
ALTER TABLE public.batch_photo_uploads ALTER COLUMN page_index DROP NOT NULL;
-- content_type, file_size, created_by, processed_at suelen ser NULLables; por si acaso:
ALTER TABLE public.batch_photo_uploads ALTER COLUMN content_type DROP NOT NULL;
ALTER TABLE public.batch_photo_uploads ALTER COLUMN file_size DROP NOT NULL;
ALTER TABLE public.batch_photo_uploads ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.batch_photo_uploads ALTER COLUMN processed_at DROP NOT NULL;

COMMENT ON TABLE public.batch_photo_uploads IS
  'Metadatos fotos bucket batch-scans. Insert vía service role (movil-upload) y cliente autenticado (MovilScanClient).';

COMMENT ON COLUMN public.batch_photo_uploads.student_index IS
  'Orden del estudiante en el lote (1-based), desde FormData student_index.';
COMMENT ON COLUMN public.batch_photo_uploads.page_index IS
  'Foto dentro del estudiante (1..N), desde FormData page_index.';

CREATE INDEX IF NOT EXISTS batch_photo_uploads_batch_idx
  ON public.batch_photo_uploads (batch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS batch_photo_uploads_teacher_idx
  ON public.batch_photo_uploads (teacher_id, created_at DESC);

CREATE INDEX IF NOT EXISTS batch_photo_uploads_batch_student_page_idx
  ON public.batch_photo_uploads (batch_id, student_index, page_index);

ALTER TABLE public.batch_photo_uploads ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.batch_photo_uploads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.batch_photo_uploads TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
