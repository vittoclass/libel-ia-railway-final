-- Sesiones de lote para captura móvil sin login: el PC registra batch_id + teacher/school; el móvil valida y sube vía API (service role).

BEGIN;

CREATE TABLE IF NOT EXISTS public.batch_scan_sessions (
  batch_id uuid PRIMARY KEY,
  teacher_id uuid NOT NULL REFERENCES public.teachers (id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  created_by uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS batch_scan_sessions_expires_idx
  ON public.batch_scan_sessions (expires_at);

COMMENT ON TABLE public.batch_scan_sessions IS
  'Registro de lotes activos para QR móvil público; validación server-side, sin lectura pública directa.';

ALTER TABLE public.batch_scan_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS batch_scan_sessions_insert_teacher ON public.batch_scan_sessions;
CREATE POLICY batch_scan_sessions_insert_teacher
  ON public.batch_scan_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND teacher_id = (SELECT p.teacher_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
    AND school_id = (SELECT p.school_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS batch_scan_sessions_select_own ON public.batch_scan_sessions;
CREATE POLICY batch_scan_sessions_select_own
  ON public.batch_scan_sessions
  FOR SELECT
  TO authenticated
  USING (
    teacher_id = (SELECT p.teacher_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS batch_scan_sessions_update_own ON public.batch_scan_sessions;
CREATE POLICY batch_scan_sessions_update_own
  ON public.batch_scan_sessions
  FOR UPDATE
  TO authenticated
  USING (
    teacher_id = (SELECT p.teacher_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  )
  WITH CHECK (
    teacher_id = (SELECT p.teacher_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
