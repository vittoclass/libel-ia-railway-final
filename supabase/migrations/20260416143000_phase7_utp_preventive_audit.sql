-- PHASE_7_UTP_AUDIT_V1
-- Modulo de auditoria preventiva y analisis 360 (aditivo y reversible)

BEGIN;

CREATE OR REPLACE FUNCTION public.is_utp_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND upper(coalesce(p.role, '')) IN ('UTP', 'DIRECCION', 'ADMIN_INSTITUCION', 'ADMIN')
  )
$$;

CREATE TABLE IF NOT EXISTS public.utp_instrument_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  uploaded_by_user_id uuid NOT NULL,
  teacher_label text NOT NULL,
  course_label text NOT NULL,
  subject text NOT NULL,
  file_name text NOT NULL,
  file_mime text NULL,
  file_size_bytes bigint NULL,
  storage_bucket text NOT NULL DEFAULT 'utp-audit-private',
  storage_path text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'analyzed' CHECK (status IN ('analyzed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.utp_audit_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL UNIQUE REFERENCES public.utp_instrument_uploads(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  analysis_summary text NOT NULL,
  question_quality jsonb NOT NULL DEFAULT '[]'::jsonb,
  curricular_alignment jsonb NOT NULL DEFAULT '[]'::jsonb,
  normative_citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  root_cause jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS utp_instrument_uploads_org_idx
  ON public.utp_instrument_uploads(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS utp_audit_reports_org_idx
  ON public.utp_audit_reports(organization_id, created_at DESC);

DROP TRIGGER IF EXISTS utp_instrument_uploads_updated_at ON public.utp_instrument_uploads;
CREATE TRIGGER utp_instrument_uploads_updated_at
  BEFORE UPDATE ON public.utp_instrument_uploads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS utp_audit_reports_updated_at ON public.utp_audit_reports;
CREATE TRIGGER utp_audit_reports_updated_at
  BEFORE UPDATE ON public.utp_audit_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.utp_instrument_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utp_audit_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS utp_instrument_uploads_select_policy ON public.utp_instrument_uploads;
CREATE POLICY utp_instrument_uploads_select_policy
  ON public.utp_instrument_uploads
  FOR SELECT
  USING (
    public.is_utp_or_admin()
    AND organization_id = public.current_scope_org_id()
  );

DROP POLICY IF EXISTS utp_instrument_uploads_insert_policy ON public.utp_instrument_uploads;
CREATE POLICY utp_instrument_uploads_insert_policy
  ON public.utp_instrument_uploads
  FOR INSERT
  WITH CHECK (
    public.is_utp_or_admin()
    AND organization_id = public.current_scope_org_id()
  );

DROP POLICY IF EXISTS utp_instrument_uploads_update_policy ON public.utp_instrument_uploads;
CREATE POLICY utp_instrument_uploads_update_policy
  ON public.utp_instrument_uploads
  FOR UPDATE
  USING (
    public.is_utp_or_admin()
    AND organization_id = public.current_scope_org_id()
  )
  WITH CHECK (
    public.is_utp_or_admin()
    AND organization_id = public.current_scope_org_id()
  );

DROP POLICY IF EXISTS utp_audit_reports_select_policy ON public.utp_audit_reports;
CREATE POLICY utp_audit_reports_select_policy
  ON public.utp_audit_reports
  FOR SELECT
  USING (
    public.is_utp_or_admin()
    AND organization_id = public.current_scope_org_id()
  );

DROP POLICY IF EXISTS utp_audit_reports_insert_policy ON public.utp_audit_reports;
CREATE POLICY utp_audit_reports_insert_policy
  ON public.utp_audit_reports
  FOR INSERT
  WITH CHECK (
    public.is_utp_or_admin()
    AND organization_id = public.current_scope_org_id()
  );

-- Storage privado para instrumentos UTP
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'utp-audit-private',
  'utp-audit-private',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS utp_audit_storage_select ON storage.objects;
CREATE POLICY utp_audit_storage_select
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'utp-audit-private'
    AND public.is_utp_or_admin()
    AND split_part(name, '/', 1) = public.current_scope_org_id()::text
  );

DROP POLICY IF EXISTS utp_audit_storage_insert ON storage.objects;
CREATE POLICY utp_audit_storage_insert
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'utp-audit-private'
    AND public.is_utp_or_admin()
    AND split_part(name, '/', 1) = public.current_scope_org_id()::text
  );

DROP POLICY IF EXISTS utp_audit_storage_delete ON storage.objects;
CREATE POLICY utp_audit_storage_delete
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'utp-audit-private'
    AND public.is_utp_or_admin()
    AND split_part(name, '/', 1) = public.current_scope_org_id()::text
  );

-- Funcion transaccional: crea upload + reporte en una sola transaccion
CREATE OR REPLACE FUNCTION public.create_utp_audit_with_report(
  p_organization_id uuid,
  p_uploaded_by_user_id uuid,
  p_teacher_label text,
  p_course_label text,
  p_subject text,
  p_file_name text,
  p_file_mime text,
  p_file_size_bytes bigint,
  p_storage_path text,
  p_analysis_summary text,
  p_question_quality jsonb,
  p_curricular_alignment jsonb,
  p_normative_citations jsonb,
  p_root_cause jsonb,
  p_recommended_actions jsonb
)
RETURNS TABLE(upload_id uuid, report_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_upload_id uuid;
  v_report_id uuid;
BEGIN
  INSERT INTO public.utp_instrument_uploads (
    organization_id,
    uploaded_by_user_id,
    teacher_label,
    course_label,
    subject,
    file_name,
    file_mime,
    file_size_bytes,
    storage_path,
    status
  ) VALUES (
    p_organization_id,
    p_uploaded_by_user_id,
    p_teacher_label,
    p_course_label,
    p_subject,
    p_file_name,
    p_file_mime,
    p_file_size_bytes,
    p_storage_path,
    'analyzed'
  )
  RETURNING id INTO v_upload_id;

  INSERT INTO public.utp_audit_reports (
    upload_id,
    organization_id,
    analysis_summary,
    question_quality,
    curricular_alignment,
    normative_citations,
    root_cause,
    recommended_actions
  ) VALUES (
    v_upload_id,
    p_organization_id,
    p_analysis_summary,
    coalesce(p_question_quality, '[]'::jsonb),
    coalesce(p_curricular_alignment, '[]'::jsonb),
    coalesce(p_normative_citations, '[]'::jsonb),
    coalesce(p_root_cause, '{}'::jsonb),
    coalesce(p_recommended_actions, '[]'::jsonb)
  )
  RETURNING id INTO v_report_id;

  RETURN QUERY SELECT v_upload_id, v_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_utp_audit_with_report(
  uuid, uuid, text, text, text, text, text, bigint, text, text, jsonb, jsonb, jsonb, jsonb, jsonb
) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
