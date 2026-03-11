# Extensión source_exam_items: alternativas y desarrollo

## ETAPA 1: AUDITORÍA

### Estructura actual (antes del cambio)

- **source_exam_items**: id, source_exam_id, item_number, item_text, axis_id, skill_id, competence, difficulty, created_at, updated_at, axis_label, skill_label (estas dos por migración previa).
- **APIs**: GET/POST `/api/source-exams/[id]/items`; PATCH/DELETE `/api/source-exams/[id]/items/[itemId]`; POST `/api/source-exams/[id]/items/import`.
- **Parser**: `app/lib/parse-bulk-items.ts` — formato estándar con separador ` | `.
- **UI**: SourceExamItemsPanel lista y edita ítems; SourceExamItemsImportDialog pega texto y previsualiza/importa.

### Columnas nuevas (solo ADD, sin tocar existentes)

| Columna         | Tipo    | Uso                                      |
|----------------|---------|------------------------------------------|
| question_type  | text    | multiple_choice \| true_false \| short_answer \| essay |
| correct_answer | text    | Respuesta correcta (alternativas)        |
| max_score      | integer | Puntaje máximo del ítem                 |
| rubric_text    | text    | Rúbrica/criterio para desarrollo        |

### Riesgo por cambio

| Archivo / cambio | Riesgo | Motivo |
|------------------|--------|--------|
| Migración SQL (ADD COLUMN IF NOT EXISTS) | Bajo | No borra columnas ni datos. |
| parse-bulk-items.ts (campos nuevos + SIMCE + desarrollo) | Bajo | Formato estándar sigue siendo el mismo; formatos nuevos son aditivos por detección. |
| API import route (mapeo a nuevas columnas) | Bajo | Solo añade campos al INSERT. |
| GET/POST/PATCH items (select y body) | Bajo | Solo añaden columnas/keys opcionales; ítems antiguos siguen respondiendo. |
| SourceExamItemsPanel (tipo, correct_answer, max_score, rubric en tipo/form/lista) | Bajo | Solo lectura/escritura de columnas nuevas; ítems sin question_type se muestran como "multiple_choice" en UI sin escribir en BD. |
| SourceExamItemsImportDialog (ayuda + columnas preview) | Bajo | Solo texto y columnas de vista previa. |

### Qué no se toca

- /api/evaluate, /api/evaluate/batch, OCR, OMR, Azure, Mistral, prompts, scoring, nota, informe, archivar, cursos, estudiantes, perfil, EvaluatorClient.
- Tablas de evaluación del estudiante (evaluation_items, etc.). No se mezcla source_exam_items con respuestas del estudiante.

---

## ETAPA 2: MIGRACIÓN SQL

**Archivo nuevo:** `supabase/migrations/20260410100000_source_exam_items_question_type_max_score.sql`

- ADD COLUMN IF NOT EXISTS question_type text NULL  
- ADD COLUMN IF NOT EXISTS correct_answer text NULL  
- ADD COLUMN IF NOT EXISTS max_score integer NULL  
- ADD COLUMN IF NOT EXISTS rubric_text text NULL  
- NOTIFY pgrst, 'reload schema'

No se eliminan columnas ni se modifican datos existentes.

---

## ETAPA 3 Y 4: ARCHIVOS MODIFICADOS Y NUEVOS

### Archivos nuevos

| Archivo | Descripción |
|--------|-------------|
| `supabase/migrations/20260410100000_source_exam_items_question_type_max_score.sql` | Migración anterior. |

### Archivos modificados

| Archivo | Cambio |
|--------|--------|
| `app/lib/parse-bulk-items.ts` | ParsedLine con question_type, correct_answer, max_score, rubric_text. Detección: línea con tab → formato SIMCE (Nº, CORRECTA, PTJE, EJE); línea con ` \| ` y 6+ partes y tipo en essay/short_answer/multiple_choice/true_false → formato desarrollo (Nº, TIPO, PTJE, EJE, HABILIDAD, ENUNCIADO); si no → formato estándar (sin cambios de contrato). |
| `app/api/source-exams/[id]/items/import/route.ts` | Inserción de question_type, correct_answer, max_score, rubric_text en cada fila. |
| `app/api/source-exams/[id]/items/route.ts` | GET: select con axis_label, skill_label, question_type, correct_answer, max_score, rubric_text. POST: body acepta question_type, correct_answer, max_score, rubric_text. |
| `app/api/source-exams/[id]/items/[itemId]/route.ts` | PATCH acepta y actualiza question_type, correct_answer, max_score, rubric_text; select devuelve esas columnas. |
| `app/components/SourceExamItemsPanel.tsx` | SourceExamItemRow con axis_label, skill_label, question_type, correct_answer, max_score, rubric_text. Tabla con columnas Tipo, Resp. correcta, Puntaje; ítems sin question_type se muestran como "multiple_choice" (solo UI). Formulario de edición/alta con tipo, respuesta correcta, puntaje máximo, rúbrica. |
| `app/components/SourceExamItemsImportDialog.tsx` | Texto de ayuda con los tres formatos; vista previa con columnas Tipo y Puntaje; colspan corregido para filas inválidas. |

---

## Por qué no rompe nada

1. **Solo añadido**: columnas nuevas son NULL para ítems existentes; ninguna lógica de evaluación, scoring ni informe lee o escribe estas columnas.
2. **Formato estándar intacto**: el parser sigue aceptando `número | enunciado | ...`; SIMCE y desarrollo se detectan por tab o por segundo campo “tipo” conocido.
3. **Compatibilidad hacia atrás**: GET devuelve columnas nuevas (null si no existen en BD hasta aplicar migración); la UI muestra "multiple_choice" cuando question_type es null sin modificar la BD.
4. **Evaluación y scoring**: no se tocan APIs de evaluación ni tablas de respuestas del estudiante.

---

## Checklist de pruebas manuales

- [ ] Evaluación normal sigue funcionando.
- [ ] Nota y resumen no cambian.
- [ ] Ver informe y Archivar funcionan.
- [ ] Cursos y Estudiantes funcionan.
- [ ] Pruebas base y listado de ítems funcionan.
- [ ] Edición manual de ítems funciona (incluidos tipo, respuesta correcta, puntaje, rúbrica).
- [ ] Importación masiva formato estándar (pipe) sigue funcionando.
- [ ] Importación formato SIMCE (tab: Nº, CORRECTA, PTJE, EJE) importa y se ven tipo multiple_choice, puntaje y eje.
- [ ] Importación formato desarrollo (Nº | TIPO | PTJE | EJE | HABILIDAD | ENUNCIADO) importa y se ven tipo, puntaje, eje, habilidad, enunciado.
- [ ] Ítems antiguos sin question_type se muestran como "multiple_choice" en la tabla y no se reescriben en BD al solo abrir/cerrar el panel.
