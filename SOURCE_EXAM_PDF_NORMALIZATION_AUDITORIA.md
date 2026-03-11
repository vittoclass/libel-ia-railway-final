# Corrección extracción PDF + normalización estructural – Auditoría

## ETAPA 1: AUDITORÍA

### 1. Por qué la extracción de PDF probablemente no está funcionando

- **Librería en Node:** El código hace `import("pdf-parse")`; en Next.js (Route Handler en Node) el paquete puede resolverse al build genérico. `pdf-parse` v2 expone un subpath **`pdf-parse/node`** para Node; usar el punto de entrada principal puede cargar código pensado para browser o con dependencias (worker, canvas) que fallen en el servidor.
- **Validación MIME:** En la API se exige `file.type === "application/pdf"`. En muchos navegadores, al seleccionar un PDF desde disco, `file.type` puede venir vacío; entonces se rechaza el archivo aunque el nombre sea `.pdf`.
- **Clave FormData:** El cliente envía `formData.append("file", file)` y la API lee `formData.get("file") ?? formData.get("pdf")`, así que la clave está alineada. No parece la causa principal.
- **Respuesta y textarea:** Si la extracción lanza en el servidor (p. ej. al cargar pdfjs en Node), el cliente recibe 422 y el toast de error; el textarea no se rellena. No hay fallo en “insertar texto en el textarea” si la petición no es ok.
- **Conclusión:** Las causas más probables son (1) uso del build incorrecto de pdf-parse en Node y (2) rechazo de PDFs válidos cuando `file.type` está vacío.

### 2. Archivos nuevos a crear

| Archivo | Propósito |
|--------|-----------|
| **app/lib/normalize-source-exam-text.ts** | Normalización estructural: recibe texto bruto, devuelve `{ raw_text, normalized_text, detected_blocks?, warnings? }`. Limpia espacios y saltos de línea, normaliza finales de línea, colapsa líneas vacías repetidas, opcionalmente detecta bloques (ítem, encabezado, instrucción). Sin IA; solo reglas y regex. |

### 3. Archivos existentes a modificar

| Archivo | Cambio | Riesgo |
|--------|--------|--------|
| **app/lib/extract-text-from-pdf.ts** | Usar `pdf-parse/node` en Node para asegurar el build correcto; mantener fallback a `pdf-parse` si hace falta. Asegurar que el Buffer se pase bien (la lib ya convierte a Uint8Array). | Bajo |
| **app/api/source-exams/[id]/items/extract-pdf-text/route.ts** | Aceptar el archivo también cuando `file.type` no sea `application/pdf` pero `file.name` termine en `.pdf` (por si el navegador no envía type). Opcional: devolver en la respuesta un campo `normalized_text` aplicando la normalización estructural al texto extraído. | Bajo |
| **app/components/SourceExamItemsImportDialog.tsx** | Tras recibir texto del PDF: aplicar normalización en cliente (o usar `normalized_text` del API si se añade); cargar en el textarea el texto normalizado por defecto; permitir ver/editar y luego Previsualizar / Importar. No cambiar el flujo de pegado manual ni el de import. | Bajo |

### 4. Riesgo por archivo

- **extract-text-from-pdf.ts:** Bajo. Solo se cambia el punto de entrada de la librería en Node.
- **extract-pdf-text/route.ts:** Bajo. Solo se relaja la validación de tipo y, opcionalmente, se añade normalización en respuesta.
- **normalize-source-exam-text.ts (nuevo):** Bajo. Util puro, sin side effects, no toca evaluación ni import.
- **SourceExamItemsImportDialog.tsx:** Bajo. Uso del texto normalizado para rellenar el área; el parser y el botón Importar siguen igual.

### 5. Corrección mínima para que el PDF cargue y extraiga (FASE A)

1. En **extract-text-from-pdf.ts**: en entorno Node (`typeof process !== 'undefined' && process.versions?.node`), hacer `import("pdf-parse/node")` y usar su `PDFParse`; si falla el subpath, intentar `import("pdf-parse")`.
2. En **extract-pdf-text/route.ts**: considerar el archivo válido si `file.type === "application/pdf"` **o** `file.name && file.name.toLowerCase().endsWith(".pdf")`.
3. No cambiar claves de FormData ni el flujo del diálogo; solo asegurar que el archivo llegue y que la librería se ejecute en el build correcto.

### 6. Cómo implementar la normalización estructural sin romper el importador

- La normalización es **previa** al parser actual: entrada = texto bruto, salida = texto “ordenado” (y opcionalmente bloques/warnings). El parser flexible existente sigue recibiendo **una sola cadena** (la normalizada o la que el usuario edite).
- Flujo: **PDF → extracción → texto bruto → normalización → texto normalizado → (mostrar en textarea) → Previsualizar (parser actual) → Importar ítems válidos.** No se sustituye el parser ni la API de import; se añade un paso antes.
- Implementación en **normalize-source-exam-text.ts**: funciones puras (limpiar espacios múltiples, `\r\n` → `\n`, colapsar líneas vacías, etc.); opcionalmente detectar líneas que parezcan “Nº CORRECTA PTJE EJE” o numeración de ítem para construir `detected_blocks` sin cambiar el formato de salida que el parser espera.

### 7. Si el PDF es escaneado o con texto ilegible

- El extractor ya devuelve poco texto y se puede marcar `warning` cuando `text.trim().length < 50` y hay páginas.
- La API devuelve ese `warning` y el cliente lo muestra; el usuario puede editar o pegar manualmente. No se inserta nada hasta que se pulse “Importar ítems válidos” y el parser tenga líneas válidas.
- La normalización solo limpia y ordena el texto existente; no inventa contenido. Si el texto extraído es basura, la normalización puede reducir ruido pero no “crear” ítems válidos; el preview seguirá mostrando inválidas y no se importará basura.

### 8. Cómo se evita mezclar prueba base con evaluación del estudiante

- El endpoint **extract-pdf-text** y el util **extract-text-from-pdf** solo se usan en el flujo “Pruebas base → Ver ítems → Importar ítems”. No se tocan `/api/evaluate`, evaluation_items ni respuestas del estudiante.
- La normalización solo actúa sobre el texto que devuelve la extracción de ese PDF de prueba base; su salida se usa únicamente para previsualizar e importar en **source_exam_items**. No hay lectura ni escritura en tablas de evaluación del estudiante.

---

## Lista exacta de archivos

### Nuevos
- **app/lib/normalize-source-exam-text.ts** — Normalización estructural: `normalizeSourceExamText(raw_text)` → `{ raw_text, normalized_text, detected_blocks, warnings }`. Limpia espacios múltiples, normaliza `\r\n` a `\n`, colapsa líneas vacías repetidas; detecta bloques tipo ítem (SIMCE, numeración), encabezado e instrucción. Sin IA.

### Modificados
- **app/lib/extract-text-from-pdf.ts** — Sin cambio de API; se mantiene `import("pdf-parse")` y PDFParse. (Opcional: en Node usar build CJS vía createRequire si en producción falla el ESM.)
- **app/api/source-exams/[id]/items/extract-pdf-text/route.ts** — Se acepta el archivo cuando `file.type === "application/pdf"` **o** `file.name` termina en `.pdf`, para evitar rechazos cuando el navegador no envía type.
- **app/components/SourceExamItemsImportDialog.tsx** — (1) Aceptar PDF también por nombre (`.pdf`). (2) Tras extraer texto del PDF, se llama a `normalizeSourceExamText(text)` y se rellena el textarea con `normalized_text`; se muestran `data.warning` o `normalized.warnings` en el mismo bloque de advertencia. Toast: "Texto extraído y normalizado".

---

## Por qué no rompe nada
- No se toca evaluate, scoring, OCR/OMR, informe, archivar, cursos, estudiantes, perfil ni EvaluatorClient.
- La normalización es un util nuevo usado solo en el diálogo de importar ítems; el parser y la API de import siguen igual.
- La aceptación por extensión `.pdf` solo amplía casos válidos; no se quita la validación por type.
- Prueba base y evaluación del estudiante siguen separadas; solo se lee/escribe en el flujo de source_exam_items.

---

## Checklist de pruebas manuales
- [ ] Evaluación normal sigue funcionando.
- [ ] Ver informe y Archivar siguen funcionando.
- [ ] Cursos y Estudiantes siguen funcionando.
- [ ] Pruebas base y listado de ítems siguen funcionando.
- [ ] Importación manual por texto (pegar) sigue funcionando.
- [ ] Seleccionar un PDF envía el archivo (campo `file`); si el navegador no envía type, se acepta por nombre `.pdf`.
- [ ] PDF con texto real se extrae y el texto aparece en el área editable.
- [ ] El texto extraído se normaliza (espacios/saltos de línea) y se muestra la versión normalizada en el textarea.
- [ ] Preview sigue funcionando; líneas inválidas se reportan.
- [ ] No se borran ítems existentes; asociación evaluación ↔ prueba base se mantiene; nota y resumen no cambian.
- [ ] Si el PDF es escaneado o con poco texto, se muestra advertencia y no se inserta basura.
