-- =============================================================================
-- RESET QUIRÚRGICO: solo resultados de evaluaciones (no instrumentos ni alumnos)
-- =============================================================================
--
-- INTOCABLES (no ejecutar DELETE/TRUNCATE sobre estas tablas aquí):
--   source_exams, source_exam_items
--   student_profiles
--   pedagogy_skills, pedagogy_axes
--   schools
--
-- TABLAS QUE ESTE SCRIPT VACÍA EXPLÍCITAMENTE:
--   skill_rollup_school_semester, skill_rollup_by_batch
--   evaluations  → en cascada elimina filas ligadas por FK (ver abajo)
--
-- EFECTO EN CASCADA (PostgreSQL ON DELETE CASCADE desde evaluations):
--   evaluation_items, evaluation_summaries, evaluation_students,
--   evaluation_skill_results, evaluation_question_tags,
--   evaluation_source_exams, student_evaluations, student_projections
--   (y cualquier otra tabla con FK a evaluations.id con CASCADE)
--
-- NO incluye: utp_audit_reports, storage, courses, teachers, students (catálogo
-- phase4), etc. Si el dashboard debe quedar “cero” también en auditoría UTP,
-- eso es un paso aparte (no solicitado en la orden original).
--
-- REVERSIBILIDAD: un DELETE masivo NO es deshacible sin backup. Antes de
-- ejecutar: snapshot/PITR en Supabase, o pg_dump de las tablas afectadas.
--
-- USO: ejecutar manualmente en SQL Editor (Supabase) o psql, tras backup.
-- NO añadir como migración automática de deploy.
-- =============================================================================

BEGIN;

-- Rollups no tienen FK a evaluations; vaciar primero evita KPIs huérfanos.
DELETE FROM public.skill_rollup_school_semester;
DELETE FROM public.skill_rollup_by_batch;

-- Una sola operación: el resto de tablas de resultados caen por CASCADE.
DELETE FROM public.evaluations;

COMMIT;

-- Verificación rápida (opcional, fuera de la transacción):
-- SELECT COUNT(*) FROM public.evaluations;
-- SELECT COUNT(*) FROM public.evaluation_items;
-- SELECT COUNT(*) FROM public.skill_rollup_by_batch;
