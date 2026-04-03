-- Auditoría JOIN: utp_audit_reports ↔ evaluation_students vía evaluation_id en JSON.
-- Ejecutar en SQL Editor de Supabase o psql con tu DATABASE_URL.
-- Debe devolver al menos una fila con student_name no nulo si el cableado y datos existen.

WITH uploads AS (
  SELECT id, organization_id
  FROM utp_instrument_uploads
  ORDER BY created_at DESC
  LIMIT 50
),
reports AS (
  SELECT r.id AS report_id,
         r.upload_id,
         r.content,
         elem.value::text AS evaluation_id
  FROM utp_audit_reports r
  JOIN uploads u ON u.id = r.upload_id
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(r.content->'student_outcomes_link'->'evaluation_ids', '[]'::jsonb)
  ) AS elem(value)
  WHERE jsonb_typeof(COALESCE(r.content->'student_outcomes_link'->'evaluation_ids', '[]'::jsonb)) = 'array'
)
SELECT
  reports.report_id,
  reports.evaluation_id::uuid AS evaluation_id,
  es.student_name,
  es.course_label,
  COALESCE(es.student_name, s.student_name_raw) AS resolved_name
FROM reports
LEFT JOIN evaluation_students es ON es.evaluation_id::text = reports.evaluation_id
LEFT JOIN evaluation_summaries s ON s.evaluation_id::text = reports.evaluation_id
WHERE reports.evaluation_id IS NOT NULL
  AND reports.evaluation_id <> ''
LIMIT 25;
