-- Archivado lógico: UTP (utp_instrument_uploads) y visibilidad docente (source_exams).
-- Sin DELETE; is_archived oculta en listados.

BEGIN;

ALTER TABLE public.utp_instrument_uploads
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

ALTER TABLE public.source_exams
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

ALTER TABLE public.source_exams
  ADD COLUMN IF NOT EXISTS utp_instrument_upload_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_exams_utp_instrument_upload_id_fkey'
  ) THEN
    ALTER TABLE public.source_exams
      ADD CONSTRAINT source_exams_utp_instrument_upload_id_fkey
      FOREIGN KEY (utp_instrument_upload_id)
      REFERENCES public.utp_instrument_uploads (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS source_exams_utp_instrument_upload_id_idx
  ON public.source_exams (utp_instrument_upload_id)
  WHERE utp_instrument_upload_id IS NOT NULL;

COMMENT ON COLUMN public.source_exams.is_archived IS
  'Si true, la prueba base no aparece en listados y buscadores docente (ocultamiento lógico).';
COMMENT ON COLUMN public.source_exams.utp_instrument_upload_id IS
  'Vínculo opcional a la carga UTP; al archivar el upload se puede ocultar la misma prueba base en docente.';

COMMIT;
