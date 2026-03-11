# Subida de prueba base por PDF – Auditoría e implementación

## ETAPA 1: AUDITORÍA (sin codificar)

### 1. Dónde encaja sin romper nada

- La función vive **solo** en el flujo de **Pruebas base → Ver ítems → Importar ítems**.
- El diálogo actual **SourceExamItemsImportDialog** ya permite pegar texto, previsualizar e importar. Se añade **una opción más**: "Subir PDF" que extrae texto y rellena el mismo flujo (preview → confirmar → importar). No se toca EvaluatorClient, /api/evaluate, OCR/OMR de evaluación ni scoring.
- Encaje: **util nuevo** solo para extraer texto de PDF (sin convertir a imágenes); **endpoint nuevo** que solo devuelve texto extraído (sin insertar ítems); **diálogo extendido** con subida de PDF que reutiliza el parser y el endpoint de import ya existentes.

### 2. Archivos nuevos a crear

| Archivo | Propósito |
|--------|------------|
| **app/lib/extract-text-from-pdf.ts** | Extrae texto de un buffer PDF con `pdf-parse`. Devuelve `{ text, pageCount }`. Solo lectura de texto; no usa pdfToImages ni OCR. |
| **app/api/source-exams/[id]/items/extract-pdf-text/route.ts** | POST: recibe archivo PDF (multipart), valida teacher_id sobre la prueba base, llama a extract-text-from-pdf, responde `{ text, pageCount, warning? }`. No inserta ítems. |

### 3. Archivos existentes a modificar

| Archivo | Cambio |
|--------|--------|
| **app/components/SourceExamItemsImportDialog.tsx** | Añadir sección "Subir PDF": input file, botón "Extraer texto", llamada a extract-pdf-text, volcar texto en el textarea existente y mostrar advertencia si el texto es escaso (PDF escaneado). El usuario puede editar el texto y usar "Previsualizar" / "Importar ítems válidos" como ya hace. |
| **app/components/SourceExamItemsPanel.tsx** | Opcional: ningún cambio si la opción "Subir PDF" vive dentro del mismo diálogo "Importar ítems". Si se prefiere un botón aparte "Subir PDF" que abra el mismo diálogo con un paso inicial de PDF, se puede añadir un botón que abra el mismo diálogo (ya existe "Importar ítems"). |

Conclusión: **no es obligatorio modificar SourceExamItemsPanel**; basta con extender el diálogo para que tenga pestaña o bloque "Subir PDF" además del textarea.

### 4. Riesgo por archivo

| Archivo / cambio | Riesgo | Motivo |
|------------------|--------|--------|
| extract-text-from-pdf.ts (nuevo) | Bajo | Solo usa pdf-parse sobre buffer; no toca evaluación ni pdfToImages. |
| extract-pdf-text/route.ts (nuevo) | Bajo | Solo lectura y respuesta de texto; misma comprobación teacher_id que el resto de rutas de ítems. |
| SourceExamItemsImportDialog.tsx | Bajo | Cambio aditivo: nuevo bloque de subida de PDF que rellena el textarea; flujo de previsualización e importación no cambia. |

### 5. Límites de la primera versión segura

- **Solo PDF con texto real** (extracción vía pdf-parse). No se usa OCR ni visión en esta fase.
- **No insertar al subir**: siempre se muestra el texto extraído (editable) y luego preview; el usuario debe pulsar "Importar ítems válidos".
- **No borrar ni reemplazar** ítems existentes; el endpoint de import actual ya solo hace INSERT.
- **Límite de tamaño** del PDF en el endpoint (p. ej. 10 MB) para evitar abusos.
- Si el PDF está vacío o el texto extraído es muy corto, se muestra **advertencia** y se permite igualmente revisar/editar el texto antes de importar.

### 6. Qué pasa si el PDF es escaneado y no tiene texto extraíble

- `pdf-parse` devolverá poco o ningún texto (p. ej. solo espacios o unas pocas palabras).
- El util puede devolver `warning: "El PDF podría ser escaneado y no contener texto extraíble. Revise el texto abajo o pegue/edite manualmente."` cuando `text.trim().length < 50` y hay al menos una página.
- En la UI se muestra esa advertencia; el usuario puede editar el texto o pegar desde otra fuente. **No se inserta basura**: si tras previsualizar no hay líneas válidas, el import no añade ítems.

---

## ETAPA 2: IMPLEMENTACIÓN

(Ver código en los archivos indicados abajo.)

---

## Resumen de archivos

### Nuevos

- **app/lib/extract-text-from-pdf.ts** — Extrae texto de un Buffer PDF con `pdf-parse` (PDFParse + getText). Devuelve `{ text, pageCount, warning? }`. Si el texto es muy corto y hay páginas, añade `warning` de posible PDF escaneado.
- **app/api/source-exams/[id]/items/extract-pdf-text/route.ts** — POST: FormData con `file` o `pdf`; valida teacher_id; tamaño máx. 10 MB; llama a extractTextFromPdf; responde `{ text, pageCount, warning? }`. No inserta ítems.

### Modificados

- **app/components/SourceExamItemsImportDialog.tsx** — Bloque "Subir PDF": input file, botón "Seleccionar PDF", llamada a extract-pdf-text, volcado del texto en el textarea y muestra de `warning` si viene. El usuario puede editar el texto y usar Previsualizar / Importar ítems válidos como antes.

---

## Por qué no rompe nada

- No se toca `/api/evaluate`, OCR/OMR de evaluación, scoring, nota, informe, archivar, cursos, estudiantes, perfil ni EvaluatorClient.
- El util de extracción es nuevo y no reutiliza `pdfToImages` ni el flujo de evaluación.
- El endpoint nuevo solo devuelve texto; la inserción sigue siendo con el endpoint actual de import por texto, tras preview y confirmación del usuario.
- La opción PDF es aditiva en el diálogo; el flujo por pegado de texto sigue igual.

---

## Checklist de pruebas manuales

- [ ] Evaluación normal sigue funcionando.
- [ ] Ver informe y Archivar siguen funcionando.
- [ ] Cursos y Estudiantes siguen funcionando.
- [ ] Pruebas base y listado de ítems siguen funcionando.
- [ ] Importación manual por texto (pegar y previsualizar) sigue funcionando.
- [ ] Nueva opción "Subir PDF" visible en el diálogo de importar ítems.
- [ ] Subir un PDF con texto real: se extrae texto y se muestra en el área editable; se puede previsualizar e importar ítems válidos.
- [ ] Líneas inválidas se reportan en la previsualización; no se insertan.
- [ ] No se borran ítems existentes al importar desde PDF.
- [ ] Asociación evaluación ↔ prueba base, nota y resumen no cambian.
- [ ] PDF escaneado (sin texto): se muestra advertencia y texto vacío o muy corto; el usuario puede editar o pegar; no se inserta basura si no hay líneas válidas.
