# Importación masiva de ítems de prueba base – Auditoría e implementación

## ETAPA 1: AUDITORÍA

### 1. Dónde encaja sin romper la app

- La gestión de ítems vive en **SourceExamItemsPanel** (dentro de la pestaña "Pruebas base"). La importación masiva es una **acción más** en ese mismo panel: botón "Importar ítems" que abre un diálogo nuevo. No se toca EvaluatorClient ni flujos de evaluación.
- Encaje: **componente nuevo** (diálogo de importación) que solo escribe en `source_exam_items` vía una **API nueva** de bulk import. La edición manual existente sigue igual.

### 2. Archivos nuevos

| Archivo | Propósito |
|--------|-----------|
| **app/api/source-exams/[id]/items/import/route.ts** | POST: recibe texto o líneas, parsea formato `item_number \| item_text \| axis_label \| skill_label \| competence \| difficulty`, valida, inserta solo filas válidas en `source_exam_items`. Comprueba teacher_id. No borra ítems existentes. Devuelve resumen (total, válidas, inválidas, insertadas, errores). |
| **app/components/SourceExamItemsImportDialog.tsx** | Diálogo: textarea para pegar, ayuda de formato, botón "Previsualizar" (parseo en cliente), tabla de vista previa (válidas / con error), botón "Importar ítems válidos" que llama a la API de import. |
| **supabase/migrations/20260409100000_source_exam_items_axis_skill_labels.sql** | Añade columnas opcionales `axis_label` y `skill_label` a `source_exam_items` para guardar etiquetas de texto sin depender de catálogos (ADD COLUMN IF NOT EXISTS). |

### 3. Archivos existentes a modificar

| Archivo | Cambio |
|--------|--------|
| **app/components/SourceExamItemsPanel.tsx** | Añadir botón "Importar ítems" que abre `SourceExamItemsImportDialog`; pasar `sourceExamId` y callback `onImported` para recargar lista. |
| **app/api/source-exams/[id]/items/route.ts** | Opcional: si se añaden columnas axis_label/skill_label, incluirlas en el SELECT del GET para mostrarlas en listado. |

### 4. Riesgo por archivo

| Archivo | Riesgo |
|--------|--------|
| Nueva API import | **Bajo**: solo INSERT en source_exam_items; misma comprobación de permiso que el resto de la ruta de ítems. |
| Nuevo diálogo | **Bajo**: componente aislado; no toca evaluación ni evaluation_items. |
| SourceExamItemsPanel | **Bajo**: solo un botón y estado de apertura del diálogo. |
| Migración | **Bajo**: solo ADD COLUMN IF NOT EXISTS. |

### 5. Cómo se evita mezclar ítems de prueba base con respuestas del estudiante

- La API de import escribe **solo** en `source_exam_items` y solo para el `source_exam_id` autorizado. No toca `evaluation_items`, `evaluations` ni scoring.
- El diálogo se titula "Importar ítems de prueba base" y el texto de ayuda aclara que son ítems del instrumento en blanco, no respuestas del estudiante.

### 6. Límites para que la importación no dañe datos

- **No se borran** ítems existentes; la importación solo **añade** filas. No se implementa "reemplazar ítems existentes" en esta fase.
- Límite de líneas por petición (p. ej. 500) para evitar payloads enormes.
- Validación en backend: líneas inválidas se descartan y se reportan; no se hace rollback de las válidas por una línea mala.
- Solo se insertan filas cuyo `item_number` e `item_text` son válidos; el resto de campos son opcionales.

### 7. Qué se deja manual para reducir riesgo

- Reemplazo masivo de ítems existentes: **no** implementado. Si se desea "reemplazar todo", el usuario puede borrar manualmente y luego importar.
- Parser PDF/Word, CSV/Excel y deducción automática con IA: **no** en esta fase. Solo texto pegado con formato fijo.

---

## ETAPA 2: IMPLEMENTACIÓN

### Archivos nuevos creados

| Archivo | Descripción |
|--------|-------------|
| **app/api/source-exams/[id]/items/import/route.ts** | POST: recibe `{ text }`, usa `parseBulkItemsText` de `@/app/lib/parse-bulk-items`, valida permiso por teacher_id, inserta solo filas válidas en `source_exam_items`. Límite 500 líneas. Respuesta: total, valid, invalid, inserted, errors, message. |
| **app/lib/parse-bulk-items.ts** | Parser compartido: formato `item_number \| item_text \| axis_label \| skill_label \| competence \| difficulty`. Devuelve `{ valid: ParsedLine[], invalid: { line, reason }[] }`. Usado por la API y por el diálogo (preview en cliente). |
| **app/components/SourceExamItemsImportDialog.tsx** | Diálogo: textarea, ayuda de formato, botón Previsualizar (parseo en cliente), tabla de vista previa (válidas + inválidas), botón "Importar ítems válidos" → POST a `/api/source-exams/[id]/items/import`. Callback `onImported` para recargar lista. |
| **supabase/migrations/20260409100000_source_exam_items_axis_skill_labels.sql** | ADD COLUMN IF NOT EXISTS axis_label, skill_label en source_exam_items. |

### Archivos modificados

| Archivo | Cambio | Riesgo |
|--------|--------|--------|
| **app/components/SourceExamItemsPanel.tsx** | Estado `importDialogOpen`, botón "Importar ítems" (icono FileUp), render de `SourceExamItemsImportDialog` con `sourceExamId`, `onImported={loadItems}`. | Bajo |

### Por qué no rompe la app

- **Solo añade**: la API de import solo hace INSERT en `source_exam_items`; no DELETE ni UPDATE. No toca `evaluations`, `evaluation_items`, scoring ni informe.
- **Mismo permiso**: usa la misma comprobación `teacher_id` que GET/POST de ítems en `app/api/source-exams/[id]/items/route.ts`.
- **Componente aislado**: el diálogo es nuevo; la edición manual (agregar/editar/eliminar ítem) no se modificó.
- **Parser idéntico** en backend y cliente (lib compartida); previsualización sin llamada extra.

### Requisito previo

- Aplicar la migración `20260409100000_source_exam_items_axis_skill_labels.sql` para que existan las columnas `axis_label` y `skill_label` en `source_exam_items`. Si no está aplicada, el INSERT fallará hasta ejecutarla.

---

## Checklist de pruebas manuales

- [ ] Evaluación normal, guardado, Ver informe, Archivar, Cursos, Estudiantes: sin cambios.
- [ ] Pruebas base y edición manual de ítems: sin cambios.
- [ ] Abrir "Importar ítems" desde el panel de ítems de una prueba base.
- [ ] Pegar un listado con formato correcto y previsualizar: se ven líneas válidas.
- [ ] Pegar listado con líneas inválidas: se reportan y no bloquean las válidas.
- [ ] Importar ítems válidos: se insertan y aparecen en el listado; los ítems ya existentes siguen ahí.
- [ ] No se borran ítems existentes por accidente.
- [ ] Asociación evaluación ↔ prueba base, nota y resumen: sin cambios.
