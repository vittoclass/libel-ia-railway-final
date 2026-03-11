# LibelIA – Fase 1: Capa prueba base / source exam (entregable)

## 1. Análisis: dónde se integra sin romper nada

- **Tablas ya existentes** (migración `20260404000000_pedagogy_hybrid_source_exams.sql`): `source_exams`, `source_exam_items`, y columna `evaluations.source_exam_id`. No se modifican; se usan como están.
- **Motor ya existente**: `generateSkillsFromSourceExam` en `app/lib/generate-skills-from-source-exam.ts` y selector en `app/lib/pedagogy-mode.ts` (prioridad `source_exam` > `structured` > `text`). Se mantienen; solo se añaden comentarios y una lectura opcional desde la tabla puente.
- **Puntos de integración añadidos**:
  - Nueva tabla **`evaluation_source_exams`**: asociación explícita evaluación ↔ prueba base (tabla puente).
  - Nuevos archivos **solo de soporte**: tipos y utilidades de lectura/escritura. No sustituyen ni tocan `/api/evaluate`, OCR, OMR, flujos de corrección ni “Ver informe”.

**Archivos sensibles que no se tocan**:  
`/api/evaluate`, `/api/evaluate/batch`, rutas de OCR/OMR, extract-name, prompts, scoring, login, onboarding, componentes de “Ver informe” y “Archivar”, pantallas de Perfil/Cursos/Estudiantes.

---

## 2. Listado exacto de archivos

### Archivos nuevos

| Archivo | Propósito |
|--------|-----------|
| `supabase/migrations/20260407000000_evaluation_source_exams_bridge.sql` | Crea tabla puente `evaluation_source_exams` y backfill desde `evaluations.source_exam_id`. |
| `app/lib/source-exam-types.ts` | Interfaces: `SourceExamRow`, `SourceExamItemRow`, `EvaluationSourceExamRow`, `AssociateEvaluationSourceExamPayload`. |
| `app/lib/source-exam-db.ts` | Utilidades: `getSourceExamById`, `getSourceExamItems`, `getSourceExamForEvaluation`, `associateEvaluationToSourceExam`, `disassociateEvaluationFromSourceExam`. |

### Archivos modificados

| Archivo | Cambio | Riesgo |
|--------|--------|--------|
| `app/lib/generate-skills-from-source-exam.ts` | Comentario de cabecera ampliado; obtención de `source_exam_id` vía `getSourceExamForEvaluation` (puente o `evaluations.source_exam_id`). Comportamiento anterior se mantiene si la asociación sigue en `evaluations.source_exam_id`. | Bajo: solo lectura adicional; fallback al valor actual. |
| `app/lib/pedagogy-mode.ts` | Comentario de cabecera: prioridad `source_exam` > `structured` > `text`. Sin cambios de lógica. | Nulo. |

---

## 3. Migraciones SQL

- **Única migración nueva**: `20260407000000_evaluation_source_exams_bridge.sql`
  - `CREATE TABLE IF NOT EXISTS public.evaluation_source_exams` con `evaluation_id` (PK, FK a `evaluations`), `source_exam_id` (FK a `source_exams`), `created_at`.
  - Índice en `source_exam_id`.
  - Backfill: `INSERT ... SELECT id, source_exam_id FROM evaluations WHERE source_exam_id IS NOT NULL ON CONFLICT (evaluation_id) DO NOTHING`.
  - No se alteran tablas existentes ni se eliminan columnas; solo se añade una tabla y datos derivados.

---

## 4. Código TypeScript/JS añadido

- **Tipos** (`source-exam-types.ts`): alineados con `source_exams`, `source_exam_items` y la nueva tabla puente.
- **Utilidades** (`source-exam-db.ts`):
  - Lectura: `getSourceExamById`, `getSourceExamItems`, `getSourceExamForEvaluation` (puente primero, luego `evaluations.source_exam_id`).
  - Escritura: `associateEvaluationToSourceExam` (escribe en puente y en `evaluations.source_exam_id` para no romper el motor actual), `disassociateEvaluationFromSourceExam`.
- **Motor** (`generate-skills-from-source-exam.ts`): usa `getSourceExamForEvaluation` para decidir la prueba base; si no hay asociación, devuelve `null` y el flujo sigue igual.

---

## 5. Cómo se evita romper la app

- **Solo añadidos**: tabla nueva, archivos nuevos de tipos y utilidades; cambios en código existente mínimos y localizados.
- **Compatibilidad**: la asociación se escribe en **dos** sitios (puente y `evaluations.source_exam_id`), de modo que todo lo que hoy lee `evaluations.source_exam_id` (p. ej. `resolvePedagogyMode`, backfill) sigue funcionando.
- **Documentos separados**: en tipos y comentarios se deja claro que `source_exam` ≠ `evaluation` ≠ `answer_key` ≠ `rubric`; no se mezclan documentos.
- **Fallback**: si la tabla puente no existe o falla, `getSourceExamForEvaluation` puede devolver solo desde `evaluations`; el motor sigue pudiendo usar `evaluation.source_exam_id` como antes.
- **Sin tocar**: `/api/evaluate`, OCR, OMR, “Ver informe”, flujos de guardado existentes.

---

## 6. Notas de riesgo

- **Migración**: al aplicar la migración, el backfill inserta filas en `evaluation_source_exams` para evaluaciones que ya tienen `source_exam_id`. Si en el futuro se elimina la columna `evaluations.source_exam_id`, habría que pasar a leer solo de la puente (cambio controlado).
- **Supabase**: si el proyecto no usa Supabase o las migraciones no se aplican, la tabla puente no existirá; las utilidades que la usan pueden fallar en esas rutas. El motor tiene fallback a `evaluations.source_exam_id`.
- **RLS**: las tablas nuevas no tienen RLS en esta fase; si más adelante se activa RLS en `evaluations`/`source_exams`, habría que definir políticas para `evaluation_source_exams`.

---

## 7. Siguientes pasos recomendados (sin ejecutarlos si son invasivos)

1. **Fase 2 – Asociación segura en UI**: pantalla o flujo para asociar manualmente una evaluación a una prueba base (llamada a `associateEvaluationToSourceExam` desde una ruta API nueva, sin tocar el flujo de corrección).
2. **API de prueba base**: rutas solo lectura para listar `source_exams` y ítems (por ejemplo `GET /api/source-exams`, `GET /api/source-exams/[id]/items`) usando las utilidades de `source-exam-db.ts`.
3. **Carga de prueba base**: flujo para crear `source_exams` y `source_exam_items` desde PDF/Word en blanco (parser nuevo, sin mezclar con el documento de la evaluación del estudiante).
4. **Refuerzo pedagógico**: asegurar que el cálculo de logro por pregunta → alumno → curso esté cubierto en `generateSkillsFromSourceExam` y en la persistencia en `evaluation_skill_results` (revisión sin cambiar contratos ya usados).

No se ha modificado “Ver informe”, ni se ha movido pedagogía nueva dentro de ese modal.
