-- PASO A — Infraestructura aditiva (docente / híbrido móvil-PC).
-- Reversible: DROP policies/tables/bucket en orden inverso (ver comentario final).
-- NO modifica tablas de evaluaciones ni OMR. Sin FK desde estas tablas hacia evaluations.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) teacher_assignments — Zero-typing (carga horaria / asignaciones)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.teachers (id) ON DELETE CASCADE,
  academic_year int NOT NULL,
  semester text NOT NULL CHECK (semester IN ('H1', 'H2')),
  subject text NOT NULL,
  course_label text NOT NULL,
  course_id uuid NULL,
  weekly_hours numeric(5, 2) NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_assignments_unique_scope UNIQUE (
    teacher_id,
    academic_year,
    semester,
    course_label,
    subject
  )
);

CREATE INDEX IF NOT EXISTS teacher_assignments_teacher_year_semester_idx
  ON public.teacher_assignments (teacher_id, academic_year, semester)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS teacher_assignments_school_idx
  ON public.teacher_assignments (school_id);

COMMENT ON TABLE public.teacher_assignments IS
  'Asignaciones docente–curso–asignatura para precarga de contexto (zero-typing). Sin FK a evaluations.';

DROP TRIGGER IF EXISTS teacher_assignments_updated_at ON public.teacher_assignments;
CREATE TRIGGER teacher_assignments_updated_at
  BEFORE UPDATE ON public.teacher_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS teacher_assignments_select_own ON public.teacher_assignments;
CREATE POLICY teacher_assignments_select_own
  ON public.teacher_assignments
  FOR SELECT
  TO authenticated
  USING (
    teacher_id = (
      SELECT p.teacher_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  );

-- Carga inicial suele hacerse con service_role / SQL; docente solo lee.
DROP POLICY IF EXISTS teacher_assignments_insert_own ON public.teacher_assignments;
CREATE POLICY teacher_assignments_insert_own
  ON public.teacher_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    teacher_id = (
      SELECT p.teacher_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
    AND school_id = (
      SELECT p.school_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS teacher_assignments_update_own ON public.teacher_assignments;
CREATE POLICY teacher_assignments_update_own
  ON public.teacher_assignments
  FOR UPDATE
  TO authenticated
  USING (
    teacher_id = (
      SELECT p.teacher_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  )
  WITH CHECK (
    teacher_id = (
      SELECT p.teacher_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS teacher_assignments_delete_own ON public.teacher_assignments;
CREATE POLICY teacher_assignments_delete_own
  ON public.teacher_assignments
  FOR DELETE
  TO authenticated
  USING (
    teacher_id = (
      SELECT p.teacher_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  );

-- -----------------------------------------------------------------------------
-- 2) batch_photo_uploads — cola híbrida (sin FK a evaluations.batch_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.batch_photo_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.teachers (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  content_type text NULL,
  file_size bigint NULL,
  created_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS batch_photo_uploads_batch_idx
  ON public.batch_photo_uploads (batch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS batch_photo_uploads_teacher_idx
  ON public.batch_photo_uploads (teacher_id, created_at DESC);

COMMENT ON TABLE public.batch_photo_uploads IS
  'Metadatos de fotos subidas al bucket batch-scans; batch_id es UUID de lote (mismo uso que evaluations.batch_id), sin FK a evaluations.';

ALTER TABLE public.batch_photo_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS batch_photo_uploads_select_own ON public.batch_photo_uploads;
CREATE POLICY batch_photo_uploads_select_own
  ON public.batch_photo_uploads
  FOR SELECT
  TO authenticated
  USING (
    teacher_id = (
      SELECT p.teacher_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS batch_photo_uploads_insert_own ON public.batch_photo_uploads;
CREATE POLICY batch_photo_uploads_insert_own
  ON public.batch_photo_uploads
  FOR INSERT
  TO authenticated
  WITH CHECK (
    teacher_id = (
      SELECT p.teacher_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
    AND school_id = (
      SELECT p.school_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
    AND created_by = auth.uid()
  );

-- Actualizar processed_at desde backend con service_role (sin política UPDATE para authenticated).

-- Realtime: exponer cambios a suscriptores (respeta RLS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'batch_photo_uploads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.batch_photo_uploads;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) Storage: bucket privado batch-scans
-- Ruta obligatoria: {teacher_id}/{batch_id}/{archivo}
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'batch-scans',
  'batch-scans',
  false,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS batch_scans_select_own ON storage.objects;
CREATE POLICY batch_scans_select_own
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'batch-scans'
    AND split_part(name, '/', 1) = (
      SELECT p.teacher_id::text
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
    AND split_part(name, '/', 1) <> ''
  );

DROP POLICY IF EXISTS batch_scans_insert_own ON storage.objects;
CREATE POLICY batch_scans_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'batch-scans'
    AND split_part(name, '/', 1) = (
      SELECT p.teacher_id::text
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
    AND split_part(name, '/', 1) <> ''
  );

DROP POLICY IF EXISTS batch_scans_update_own ON storage.objects;
CREATE POLICY batch_scans_update_own
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'batch-scans'
    AND split_part(name, '/', 1) = (
      SELECT p.teacher_id::text
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  )
  WITH CHECK (
    bucket_id = 'batch-scans'
    AND split_part(name, '/', 1) = (
      SELECT p.teacher_id::text
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS batch_scans_delete_own ON storage.objects;
CREATE POLICY batch_scans_delete_own
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'batch-scans'
    AND split_part(name, '/', 1) = (
      SELECT p.teacher_id::text
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;

-- -----------------------------------------------------------------------------
-- REVERSIBILIDAD (ejecutar manualmente si hay que deshacer PASO A):
-- -----------------------------------------------------------------------------
-- DELETE FROM storage.objects WHERE bucket_id = 'batch-scans';
-- DELETE FROM storage.buckets WHERE id = 'batch-scans';
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.batch_photo_uploads;
-- DROP TABLE public.batch_photo_uploads;
-- DROP TABLE public.teacher_assignments;
-- (Eliminar políticas storage si quedan huérfanas según versión.)
