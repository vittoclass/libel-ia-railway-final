-- Historial de exportaciones ZIP de informes pedagógicos por lote (reversible: DROP TABLE).
-- No afecta OMR ni evaluación; solo metadatos opcionales para "Mis archivos".

CREATE TABLE IF NOT EXISTS public.batch_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  zip_filename text NOT NULL,
  exam_title text,
  course_label text,
  evaluation_ids uuid[] NOT NULL DEFAULT '{}',
  evaluation_count integer NOT NULL DEFAULT 0,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS batch_exports_user_created_idx
  ON public.batch_exports (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS batch_exports_batch_id_idx
  ON public.batch_exports (batch_id);

COMMENT ON TABLE public.batch_exports IS
  'Registro de exportaciones masivas ZIP de informes pedagógicos; storage_path reservado para enlaces futuros.';

ALTER TABLE public.batch_exports ENABLE ROW LEVEL SECURITY;

-- Lectura/escritura solo del propietario (API con service role sigue pudiendo insertar/select según políticas del proyecto).
CREATE POLICY batch_exports_select_own ON public.batch_exports
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY batch_exports_insert_own ON public.batch_exports
  FOR INSERT WITH CHECK (auth.uid() = user_id);
