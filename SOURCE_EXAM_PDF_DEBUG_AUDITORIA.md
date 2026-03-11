# Depuración subida y extracción PDF – Auditoría

## ETAPA 1: AUDITORÍA DEL FLUJO

### Flujo completo

1. **Input file** — `accept="application/pdf"`, `onChange={handlePdfUpload}`
2. **onChange** — Se obtiene `file = e.target.files?.[0]`, se valida `isPdf`, `setPdfExtracting(true)`, `setPdfWarning(null)`
3. **FormData** — `formData.append("file", file)`
4. **fetch** — POST a `/api/source-exams/${sourceExamId}/items/extract-pdf-text`, `credentials: "include"`, `body: formData`
5. **Respuesta** — `const data = await res.json().catch(() => ({}))` → si el body no es JSON, `data = {}`
6. **Si res.ok** — `rawText = data.text ?? ""`, `normalizeSourceExamText(rawText)`, `setText(normalized.normalized_text)`, toasts y warnings
7. **Si !res.ok** — toast con `data.error`, `data.details`
8. **catch** — toast genérico "Error de conexión" **sin mostrar el error real** (se traga la excepción)
9. **finally** — `setPdfExtracting(false)`, se limpia el input

### Causas probables

1. **API devuelve 200 pero sin `text`** (p. ej. body HTML por error de Next o middleware): `res.json().catch(() => ({}))` → `data = {}`, `rawText = ""`, `setText("")` → el usuario ve la carga, luego éxito y textarea vacío = "no pasa nada".
2. **`extractTextFromPdf` falla en Node** (pdf-parse/build en servidor): la API responde 422 con `{ error, details }`; si el cliente no muestra bien `details` o el toast es poco visible, parece que "no pasa nada".
3. **catch en el cliente**: si `fetch` o `res.json()` lanza (p. ej. body no es JSON), el catch solo muestra "Error de conexión" y no el mensaje real.
4. **respuesta no JSON**: 500/502 con HTML → `res.json()` lanza → catch → "Error de conexión" sin detalle.

### Archivos a modificar

| Archivo | Cambio | Riesgo |
|--------|--------|--------|
| **app/api/source-exams/[id]/items/extract-pdf-text/route.ts** | Logs temporales (file name/size, buffer length, texto length, errores). Opcional: intentar require CJS de pdf-parse en Node si el import falla. | Bajo |
| **app/lib/extract-text-from-pdf.ts** | Logs al cargar módulo y al extraer. En Node, intentar primero require("pdf-parse") (CJS) y usar PDFParse; si falla, usar import("pdf-parse"). | Bajo |
| **app/components/SourceExamItemsImportDialog.tsx** | Logs en handlePdfUpload (file, res.ok, status, data, longitudes). Mostrar error real en catch. Si res.ok y rawText vacío, aviso claro. Mejorar mensaje cuando !res.ok (incluir status y body si hace falta). | Bajo |

### Riesgo por archivo

- Solo se añaden logs y manejo de errores más explícito; no se cambia lógica de negocio ni flujos sensibles.

---

## ETAPA 2: CORRECCIONES

- Añadir logs temporales en API, extractor y diálogo.
- En el diálogo: en catch, mostrar `err?.message || String(err)` en el toast.
- En el diálogo: si `res.ok` y `rawText === ""`, mostrar aviso "No se extrajo texto (¿PDF escaneado o respuesta vacía?)" y opcionalmente setPdfWarning.
- En el diálogo: si `!res.ok`, leer `res.text()` para no asumir JSON y mostrar status y mensaje en el toast.
- En el extractor: en Node usar require("pdf-parse") para CJS; si no está disponible o falla, usar import("pdf-parse").

---

## Checklist manual para probar con PDFs reales

1. Abrir consola del navegador (F12) y consola del servidor (terminal `next dev`).
2. Pruebas base → una prueba → Ver ítems → Importar ítems → "Seleccionar PDF" → elegir PDF con texto.
3. Navegador: ver `[ImportDialog PDF] file selected:` y `[ImportDialog PDF] response:` (ok, status, textLength).
4. Servidor: ver `[extract-pdf-text] file received:` y `[extract-text-from-pdf]` (buffer length, extracted text length) o `extraction failed`.
5. Si hay texto: textarea se rellena; si no: toast "PDF sin texto extraíble" o "Error al extraer PDF" con detalle.
6. Flujo esperado: PDF → carga → textarea (o aviso) → previsualizar → importar ítems válidos.
