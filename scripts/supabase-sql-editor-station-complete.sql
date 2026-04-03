-- =============================================================================
-- Libelia / Estación docente — SQL para pegar en Supabase → SQL Editor
-- =============================================================================
-- Corrige: "Bucket not found" (batch-scans), tabla teacher_assignments faltante,
--         profiles incompleto, y deja dato de prueba para vittoclass@gmail.com
--
-- ORDEN: Ejecuta el script completo una vez (Run). Si algo ya existe, usa IF NOT EXISTS / ON CONFLICT.
-- DESPUÉS: Recarga la app (Railway) y vuelve a iniciar sesión.
--
-- BUCKET EN DASHBOARD (opcional): Puedes crear "batch-scans" en Storage → New bucket
--       (privado), pero las políticas RLS de objetos SOLO se aplican con el SQL de abajo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Función común updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Núcleo Fase 1 (si faltara en el proyecto)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES public.schools (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teachers_school_id ON public.teachers (school_id);

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  teacher_id uuid REFERENCES public.teachers (id) ON DELETE SET NULL,
  school_id uuid REFERENCES public.schools (id) ON DELETE SET NULL,
  department text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_teacher_id ON public.profiles (teacher_id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text DEFAULT 'teacher';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid NULL;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- teacher_assignments
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
-- batch_photo_uploads (metadatos tras subir al bucket)
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

ALTER TABLE public.batch_photo_uploads
  ADD COLUMN IF NOT EXISTS student_index integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS page_index integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS batch_photo_uploads_batch_idx
  ON public.batch_photo_uploads (batch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS batch_photo_uploads_teacher_idx
  ON public.batch_photo_uploads (teacher_id, created_at DESC);

CREATE INDEX IF NOT EXISTS batch_photo_uploads_batch_student_page_idx
  ON public.batch_photo_uploads (batch_id, student_index, page_index);

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

-- Realtime (opcional; ignora error si ya está)
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
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Realtime: %', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- Storage: bucket batch-scans (nombre fijo usado por la app: BATCH_SCANS_BUCKET)
-- Ruta objeto: {teacher_id}/{batch_id}/archivo.jpg
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'batch-scans',
  'batch-scans',
  false,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

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

-- -----------------------------------------------------------------------------
-- Dato de prueba: vittoclass@gmail.com → colegio demo, profesor, perfil, carga horaria
-- Requiere que el usuario ya exista en Authentication (Auth → Users).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  demo_school_id uuid := '11111111-1111-4111-8111-111111111101';
  demo_teacher_id uuid := '22222222-2222-4222-8222-222222222202';
  uid uuid;
BEGIN
  SELECT id INTO uid
  FROM auth.users
  WHERE lower(trim(email)) = lower(trim('vittoclass@gmail.com'))
  LIMIT 1;

  IF uid IS NULL THEN
    RAISE NOTICE 'No hay usuario auth con email vittoclass@gmail.com. Créalo en Authentication → Users y vuelve a ejecutar solo el bloque DO o el INSERT de profiles/asignación.';
    RETURN;
  END IF;

  INSERT INTO public.schools (id, name)
  VALUES (demo_school_id, 'Colegio Demo Libelia (Railway)')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  INSERT INTO public.teachers (id, school_id, name)
  VALUES (demo_teacher_id, demo_school_id, 'Vittorio Class (demo)')
  ON CONFLICT (id) DO UPDATE SET
    school_id = EXCLUDED.school_id,
    name = EXCLUDED.name;

  INSERT INTO public.profiles (user_id, teacher_id, school_id, role)
  VALUES (uid, demo_teacher_id, demo_school_id, 'docente')
  ON CONFLICT (user_id) DO UPDATE SET
    teacher_id = EXCLUDED.teacher_id,
    school_id = EXCLUDED.school_id,
    role = EXCLUDED.role,
    updated_at = now();

  INSERT INTO public.teacher_assignments (
    school_id,
    teacher_id,
    academic_year,
    semester,
    subject,
    course_label,
    is_active
  )
  VALUES (
    demo_school_id,
    demo_teacher_id,
    EXTRACT(YEAR FROM NOW())::integer,
    'H1',
    'Lenguaje',
    '8° Básico A',
    true
  )
  ON CONFLICT ON CONSTRAINT teacher_assignments_unique_scope
  DO UPDATE SET
    is_active = true,
    updated_at = now();

  RAISE NOTICE 'Listo: perfil y teacher_assignments para vittoclass@gmail.com (8° Básico A · Lenguaje).';
END $$;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- FIN. Comprueba en Storage → batch-scans existe y en Table Editor → teacher_assignments hay 1 fila.
-- =============================================================================
