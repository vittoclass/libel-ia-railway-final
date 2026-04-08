-- =============================================================================
-- VACIADO SEGURO: pruebas base (source_exams / source_exam_items)
-- =============================================================================
--
-- Qué hace:
--   - Elimina TODAS las filas de source_exam_items y source_exams.
--   - No altera columnas ni constraints (cognitive_level y el resto quedan igual).
--
-- Efectos previstos por FKs existentes (solo datos, sin romper el esquema):
--   - evaluation_source_exams: filas con ese source_exam_id se borran (ON DELETE CASCADE).
--   - evaluations.source_exam_id: pasa a NULL (ON DELETE SET NULL); las evaluaciones siguen existiendo.
--   - batch_scan_sessions.source_exam_id: no tiene FK en migraciones; se anula abajo para evitar UUIDs huérfanos.
--
-- NO hace:
--   - No usa TRUNCATE ... CASCADE sobre source_exams (podría arrastrar tablas que referencian la pauta).
--   - No borra evaluaciones ni alumnos.
--
-- Alcance: todas las organizaciones / todos los docentes en la base. Si solo quieres a un teacher_id,
-- usa el bloque comentado al final en lugar del DELETE global.
--
-- Lista UTP (instrumentos subidos): vive en utp_instrument_uploads. Tras vaciar source_exams, el dashboard
-- UTP puede seguir mostrando filas de carga. Opcional: segunda transacción más abajo.
--
-- REVERSIBILIDAD: irreversible sin backup. Snapshot / PITR en Supabase o pg_dump antes de ejecutar.
--
-- USO: SQL Editor en Supabase o psql. No añadir como migración de deploy automático.
-- =============================================================================

BEGIN;

DELETE FROM public.source_exam_items;
DELETE FROM public.source_exams;

-- Referencias sueltas en sesiones de lote móvil (columna sin FK en migraciones conocidas).
UPDATE public.batch_scan_sessions
SET source_exam_id = NULL
WHERE source_exam_id IS NOT NULL;

COMMIT;

-- Verificación (opcional):
-- SELECT COUNT(*) AS source_exam_items FROM public.source_exam_items;
-- SELECT COUNT(*) AS source_exams FROM public.source_exams;
-- SELECT COUNT(*) AS evals_con_pauta FROM public.evaluations WHERE source_exam_id IS NOT NULL;
-- SELECT COUNT(*) AS bridge FROM public.evaluation_source_exams;


-- =============================================================================
-- OPCIONAL: vaciar también cargas UTP (lista de instrumentos en dashboard UTP)
-- =============================================================================
-- Descomenta solo si quieres filas en cero ahí. Borra informes de auditoría ligados (ON DELETE CASCADE).
-- Los archivos en Storage (bucket utp-audit-private u otros) no se eliminan con este SQL; limpieza de
-- objetos es un paso aparte en el panel de Storage si lo necesitas.
--
-- BEGIN;
-- DELETE FROM public.utp_instrument_uploads;
-- COMMIT;
-- =============================================================================


-- =============================================================================
-- ALTERNATIVA: solo un docente (reemplaza el UUID de teacher_id)
-- =============================================================================
-- BEGIN;
-- DELETE FROM public.source_exam_items
-- WHERE source_exam_id IN (SELECT id FROM public.source_exams WHERE teacher_id = '00000000-0000-0000-0000-000000000000'::uuid);
-- DELETE FROM public.source_exams
-- WHERE teacher_id = '00000000-0000-0000-0000-000000000000'::uuid;
-- UPDATE public.batch_scan_sessions SET source_exam_id = NULL WHERE source_exam_id IS NOT NULL;
-- COMMIT;
-- =============================================================================
