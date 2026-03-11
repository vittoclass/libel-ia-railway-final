# Extensión importador PDF: preguntas de desarrollo / rúbrica

## ETAPA 1: AUDITORÍA

### Dónde está el texto extraído del PDF

- El PDF se sube en **SourceExamItemsImportDialog** → POST `/api/source-exams/[id]/items/extract-pdf-text` → devuelve `{ text }`.
- Ese texto se normaliza con **normalizeSourceExamText** (espacios, saltos de línea) y se pone en el textarea.
- **parseBulkItemsText** procesa el texto línea a línea y detecta:
  - SIMCE/alternativas: `Nº CORRECTA PTJE EJE`
  - Desarrollo en línea: `Nº | TIPO | PTJE | EJE | HABILIDAD | ENUNCIADO`
  - Estándar: `número | enunciado | eje | habilidad | ...`

### Dónde empieza/termina la parte de desarrollo en el PDF

- No hay delimitador fijo. Suele ir **después** de la tabla de alternativas.
- Patrones típicos en el texto:
  - Número de ítem: `39.` o `40)` al inicio de línea.
  - Enunciado en las líneas siguientes.
  - Bloque de rúbrica: líneas con "2 puntos:", "1 punto:", "0 puntos:", "respuesta completa", "parcial", "incorrecta", "Criterio:", "Rúbrica:".
  - Opcional: "Eje: ..." dentro del bloque.

### Archivos nuevos

| Archivo | Descripción |
|--------|-------------|
| `app/lib/parse-development-blocks.ts` | Detecta bloques de desarrollo (número ítem, enunciado, puntaje, rúbrica, eje). Devuelve `ParsedLine[]` compatibles con el import. |

### Archivos modificados

| Archivo | Cambio |
|--------|--------|
| `app/components/SourceExamItemsImportDialog.tsx` | Llama a **parseDevelopmentBlocksFromText**, fusiona `valid` con ítems de desarrollo; muestra avisos de desarrollo y tooltip con rúbrica en preview. |
| `app/api/source-exams/[id]/items/import/route.ts` | Llama a **parseDevelopmentBlocksFromText** y fusiona `valid = [...bulk.valid, ...dev.items]` antes de insertar. |

### Riesgo por cambio

| Archivo / cambio | Riesgo | Motivo |
|------------------|--------|--------|
| `parse-development-blocks.ts` (nuevo) | Bajo | Solo se usa en import/preview; no toca evaluación ni scoring. |
| SourceExamItemsImportDialog | Bajo | Lógica aditiva: mismo texto, más ítems en preview/import. |
| API import | Bajo | Misma fusión; el INSERT ya soporta question_type, max_score, rubric_text. |

### Qué no se toca

- /api/evaluate, /api/evaluate/batch, scoring, OCR/OMR, Ver informe, Archivar, Cursos, Estudiantes, Perfil, EvaluatorClient, flujo principal de evaluación.
- parse-bulk-items.ts (sin cambios).
- normalize-source-exam-text.ts (sin cambios).

---

## ETAPA 2: IMPLEMENTACIÓN

- **parse-development-blocks.ts**: corta el texto en bloques por líneas que empiezan con `N.` o `N)`; en cada bloque extrae enunciado, líneas de rúbrica, puntaje máximo y "Eje: ..."; solo emite ítem si hay enunciado mínimo o rúbrica clara; devuelve `ParsedLine` con question_type essay/short_answer, max_score, rubric_text, axis_label.
- **Dialog**: en Previsualizar e Importar se fusiona `valid = [...parseBulkItemsText(text).valid, ...parseDevelopmentBlocksFromText(text).items]`; se muestran developmentWarnings y tooltip con rúbrica en la tabla.
- **API import**: misma fusión de valid; el insert sigue usando las mismas columnas (incl. rubric_text, question_type, max_score).

---

## Checklist manual

- [ ] Las alternativas (tabla Nº CORRECTA PTJE EJE) siguen importándose igual.
- [ ] En un PDF con desarrollo, los bloques de desarrollo aparecen en el preview (tipo essay/short_answer, puntaje, rúbrica).
- [ ] Al importar, los ítems de desarrollo se guardan con question_type, max_score y rubric_text.
- [ ] Los avisos de desarrollo (enunciado corto, puntaje inferido) se muestran en el preview.
- [ ] No se rompe evaluación, scoring, informe, archivar, cursos, estudiantes ni perfil.
