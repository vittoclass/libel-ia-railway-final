# Reparación capa Source Exams – Auditoría e implementación

## ETAPA 1: AUDITORÍA (sin cambiar código de app)

### 1. Archivos que usan source_exams / source_exam_items / evaluation_source_exams

| Archivo | Uso |
|--------|-----|
| **app/api/source-exams/route.ts** | GET: `.from("source_exams").select("id, title, subject, course_label, exam_type, pedagogy_mode, created_at").eq("teacher_id", ...)` · POST: `.from("source_exams").insert({ teacher_id, school_id, title, subject, course_label, exam_type, pedagogy_mode })` |
| **app/api/source-exams/[id]/items/route.ts** | `.from("source_exams").select("id, teacher_id")` · `.from("source_exam_items").insert(items)` con item_number, item_text, axis_id, skill_id, competence, difficulty |
| **app/lib/source-exam-db.ts** | `source_exams` (getSourceExamById), `source_exam_items` (getSourceExamItems), `evaluation_source_exams` (getSourceExamForEvaluation, associate, disassociate) |
| **app/lib/generate-skills-from-source-exam.ts** | `source_exam_items` con item_number, axis_id, skill_id |
| **app/lib/source-exam-types.ts** | Tipos: teacher_id, school_id, title, subject, course_label, exam_type, pedagogy_mode, source_file_name, source_text, created_at; items: item_number, item_text, axis_id, skill_id, competence, difficulty |
| **app/components/SourceExamsSection.tsx** | Consume `j.source_exams` del GET |
| **app/EvaluatorClient.tsx** | Consume `j.source_exams` con id, title para el modal “Asociar a prueba base” |

### 2. Columnas que esperan la UI y las APIs

- **source_exams (mínimo para listar/crear):**  
  `id`, `teacher_id`, `school_id`, `title`, `subject`, `course_label`, `exam_type`, `pedagogy_mode`, `created_at`. Opcional: `source_file_name`, `source_text`. No se usa aún `user_id` ni `description` en la API actual.
- **source_exam_items:**  
  `id`, `source_exam_id`, `item_number`, `item_text`, `axis_id`, `skill_id`, `competence`, `difficulty`, `created_at`. La API de ítems y `generate-skills-from-source-exam` no usan `question_type`, `alternatives_json`, `correct_answer`, `axis`/`skill`/`competency` como columnas distintas (se usan axis_id/skill_id).
- **evaluation_source_exams:**  
  `evaluation_id` (PK), `source_exam_id`, `created_at`. La API y source-exam-db no usan `id` separado ni `user_id`/`teacher_id`/`match_method`/`confidence`.

### 3. Tablas que ya existen en migraciones y cuáles faltan en BD real

- **En código de migraciones:**  
  - `20260404000000_pedagogy_hybrid_source_exams.sql`: crea `source_exams` y `source_exam_items` (source_exam_items con FK a `pedagogy_axes` y `pedagogy_skills`). Añade `evaluations.source_exam_id` y opcionalmente FK.  
  - `20260407000000_evaluation_source_exams_bridge.sql`: crea `evaluation_source_exams` y backfill desde `evaluations.source_exam_id`.
- **Problema:**  
  Si en el proyecto real no se han aplicado esas migraciones, o si `20260404` falló (por ejemplo porque `pedagogy_axes`/`pedagogy_skills` no existían o por orden de ejecución), entonces `source_exams` (y por tanto `source_exam_items` y `evaluation_source_exams`) no existen en el schema cache de Supabase, lo que produce: *"Could not find the table 'public.source_exams' in the schema cache"*.

### 4. Migraciones existentes relacionadas con source exams

- **20260404000000_pedagogy_hybrid_source_exams.sql**  
  Crea `source_exams`, `source_exam_items` (con REFERENCES a `pedagogy_axes` y `pedagogy_skills`), altera `evaluations` y añade FK `evaluations.source_exam_id` → `source_exams(id)`.
- **20260407000000_evaluation_source_exams_bridge.sql**  
  Crea `evaluation_source_exams` (FK a `evaluations` y `source_exams`) y hace backfill.

Dependencia crítica: `source_exam_items` en 20260404 depende de que existan `pedagogy_axes` y `pedagogy_skills` (20250601). Si en el entorno real no se aplicó 20250601 antes, o el orden fue otro, el CREATE de `source_exam_items` puede fallar y dejar la base sin tablas de source exams.

### 5. Riesgo de incompatibilidad

- **Bajo:** La API y la UI ya usan nombres de columnas y tablas alineados con las migraciones 20260404 y 20260407. Una migración nueva que cree las mismas tablas/columnas con IF NOT EXISTS y sin pasos destructivos es compatible.
- **Medio si se depende de pedagogy_axes/pedagogy_skills:** En 20260404, `source_exam_items` tiene FK a esas tablas. En entornos donde no existan, la migración falla. La solución mínima es crear `source_exam_items` sin esas FK (solo columnas `axis_id`/`skill_id` como UUID NULL), para que la tabla exista siempre; la app ya trabaja con axis_id/skill_id sin exigir FK.

### 6. Solución mínima propuesta (sin tocar flujos sensibles de la app)

- Añadir **una sola migración SQL** que deje operativas las tres tablas en cualquier proyecto que tenga al menos `evaluations`:
  1. **source_exams**  
     CREATE IF NOT EXISTS con: id, teacher_id, school_id, title, subject, course_label, exam_type, pedagogy_mode, source_file_name, source_text, created_at. Añadir `updated_at` con ADD COLUMN IF NOT EXISTS.
  2. **source_exam_items**  
     CREATE IF NOT EXISTS con: id, source_exam_id (FK a source_exams), item_number, item_text, axis_id (uuid NULL sin FK), skill_id (uuid NULL sin FK), competence, difficulty, created_at. Así la tabla se crea aunque no existan pedagogy_axes/pedagogy_skills.
  3. **evaluations**  
     ADD COLUMN IF NOT EXISTS source_exam_id; añadir FK a source_exams solo si no existe.
  4. **evaluation_source_exams**  
     CREATE IF NOT EXISTS (evaluation_id PK, source_exam_id, created_at) con FK a evaluations y source_exams. Backfill desde evaluations.source_exam_id con ON CONFLICT DO NOTHING.
- No tocar `/api/evaluate`, EvaluatorClient (salvo que haga falta un ajuste mínimo por nombres de columnas, que con la migración anterior no debería). No añadir parser, OCR, OMR ni lógica pedagógica nueva.

---

## ETAPA 2: IMPLEMENTACIÓN

### Archivos nuevos

- **supabase/migrations/20260408100000_ensure_source_exams_operational.sql**  
  Migración única que crea/asegura `source_exams`, `source_exam_items` y `evaluation_source_exams` y deja `evaluations.source_exam_id` y FK coherentes.

### Archivos existentes a modificar

- **Ninguno** si la migración define exactamente las columnas que ya usan la API y la UI. Si tras aplicar la migración se detectara algún fallo por nombre de columna, se haría un ajuste mínimo solo en la ruta o utilidad afectada (riesgo bajo).

### Riesgo de cada cambio

- **Nueva migración:** Bajo. Solo CREATE IF NOT EXISTS y ADD COLUMN / ADD CONSTRAINT IF NOT EXISTS; no borra ni reemplaza datos. Compatible con que 20260404/20260407 ya se hayan aplicado (los IF NOT EXISTS evitan duplicados o errores).

### Por qué esta solución no rompe la app

- Solo se añaden tablas y columnas; no se modifican rutas de evaluación, scoring ni informe.
- Nombres de tablas y columnas coinciden con lo que ya usan `app/api/source-exams`, `app/lib/source-exam-db.ts` y el resto del código de pruebas base.
- source_exam_items se crea sin FK a pedagogy_axes/pedagogy_skills para que la migración no falle en proyectos donde esas tablas no existan o se apliquen después.

---

## Migración SQL completa

La migración está en:

**`supabase/migrations/20260408100000_ensure_source_exams_operational.sql`**

Contenido resumido:

1. **source_exams** – CREATE TABLE IF NOT EXISTS con: id, teacher_id, school_id, title, subject, course_label, exam_type, pedagogy_mode, source_file_name, source_text, created_at. ADD COLUMN IF NOT EXISTS updated_at. Índice en teacher_id.
2. **source_exam_items** – CREATE TABLE IF NOT EXISTS con: id, source_exam_id (FK a source_exams), item_number, item_text, axis_id (uuid NULL), skill_id (uuid NULL), competence, difficulty, created_at. ADD COLUMN IF NOT EXISTS updated_at. Índice en source_exam_id. Sin FK a pedagogy_axes/pedagogy_skills para que la migración no falle si no existen.
3. **evaluations** – ADD COLUMN IF NOT EXISTS source_exam_id. ADD CONSTRAINT evaluations_source_exam_id_fkey si no existe (FK a source_exams).
4. **evaluation_source_exams** – CREATE TABLE IF NOT EXISTS (evaluation_id PK, source_exam_id, created_at) con FK a evaluations y source_exams. Índice en source_exam_id.
5. **Backfill** – INSERT desde evaluations donde source_exam_id IS NOT NULL con ON CONFLICT (evaluation_id) DO NOTHING.
6. NOTIFY pgrst, 'reload schema'.

No se modifican archivos de aplicación; la API y la UI ya usan estos nombres de tablas y columnas.

---

## Checklist de verificación manual después de aplicar la migración

- [ ] En Supabase (SQL o Schema): existen `public.source_exams`, `public.source_exam_items`, `public.evaluation_source_exams`.
- [ ] La pestaña “Pruebas base” carga sin error “Could not find the table 'public.source_exams'”.
- [ ] Crear una prueba base desde la UI guarda y la nueva fila aparece en el listado.
- [ ] Asociar una evaluación a una prueba base desde el detalle de la evaluación funciona y la asociación se persiste.
- [ ] La nota y el resumen de la evaluación no cambian al asociar.
- [ ] Evaluaciones, Cursos, Estudiantes, Ver informe y Archivar siguen funcionando igual.
