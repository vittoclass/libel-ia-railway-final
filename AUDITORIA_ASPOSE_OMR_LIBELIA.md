# Auditoría e integración Aspose.OMR Cloud — LibelIA

## 1. Auditoría de integración

### Dónde se genera hoy `GridReadResult[]`

- **Flujo robusto**: `app/components/RobustLibeliaOMRModal.tsx` → tras corregir perspectiva (fiduciales o contorno), llama a `readLibelIASheetFromImage(imageToRead, answerKey.length, optionsList)` en `app/lib/omr-libelia-reader.ts`, que devuelve `Promise<GridReadResult[]>`.
- **Tipo**: `GridReadResult = { pregunta: number, respuesta: string, confianza: number }`. `respuesta` puede ser `""`, `"A"`–`"E"`, `"DOBLE_MARCA"`, etc.
- **Consumidores**: el resultado se mapea a `studentAnswers` y se envía a `/api/omr/compare`; luego revisión y `/api/evaluations/retry-save`. No se tocan.

### Punto de reemplazo del lector

- Único punto a cambiar: en `RobustLibeliaOMRModal`, donde hoy se llama a `readLibelIASheetFromImage(...)`. Ahí se puede intentar primero la lectura con Aspose (vía API interna) y, si falla o no está configurado, usar `readLibelIASheetFromImage` como fallback.

### Compatibilidad con compare, review y retry-save

- Se mantiene el contrato: mismo `GridReadResult[]` (pregunta 1..N, respuesta, confianza). El compare, la revisión y el retry-save siguen recibiendo el mismo formato; no se modifican.

### Cómo enviar la imagen a Aspose.OMR Cloud

- Aspose.OMR Cloud requiere:
  1. **Autenticación**: JWT con `client_id` y `client_secret` (POST a `https://api.aspose.cloud/connect/token`, grant_type=client_credentials).
  2. **Reconocimiento**: POST a `https://api.aspose.cloud/v5.0/omr/RecognizeTemplate/PostRecognizeTemplate` con cuerpo JSON: `Images: [ base64 de la imagen ]`, `omrFile: base64 del archivo de patrón .omr`, `outputFormat: "JSON"`, `recognitionThreshold` (opcional).
  3. **Resultado**: la API devuelve un GUID (id de tarea). Se obtienen los resultados con GET `https://api.aspose.cloud/v5.0/omr/RecognizeTemplate/GetRecognizeTemplate?id=<GUID>`. El resultado incluye `results[].data` en base64; decodificado es el JSON/CSV según `outputFormat`.

- Por seguridad, las credenciales no deben estar en el cliente. Por tanto la llamada a Aspose se hace desde una **ruta API de Next.js** (`/api/omr/recognize-aspose`), que lee variables de entorno y devuelve `GridReadResult[]`.

### Mapeo de la respuesta Aspose al formato LibelIA

- Con `outputFormat: "JSON"`, el contenido decodificado de `results[0].data` es un JSON que incluye elementos OMR (p. ej. por pregunta/elemento con nombre y valor). El adaptador interpreta ese JSON (p. ej. claves tipo "Q1", "1", "Question1" → pregunta 1; valor "A", "B", etc. → respuesta) y construye `GridReadResult[]` con `confianza` alta (p. ej. 0.95) cuando el valor viene de Aspose. Si Aspose devuelve CSV, se parsea y se mapea por columnas (Element Name / Value o equivalente).

---

## 2. Archivos nuevos

| Archivo | Descripción |
|---------|-------------|
| `app/api/omr/recognize-aspose/route.ts` | Ruta API que obtiene token Aspose, envía imagen + plantilla .omr (base64 desde env), espera resultado y devuelve `GridReadResult[]`. |
| `app/lib/omr-aspose-reader.ts` | Adaptador cliente: `readOMRWithAspose(imageDataUrl, numQuestions, optionLabels)` llama a la API y devuelve `Promise<GridReadResult[]>`; lanza o devuelve error si no hay credenciales o falla Aspose. |
| `AUDITORIA_ASPOSE_OMR_LIBELIA.md` | Este documento. |
| `ENV_ASPOSE_OMR.example` | Ejemplo de variables de entorno para Aspose (copiar a .env.local). |

---

## 3. Archivos modificados

| Archivo | Cambio | Riesgo |
|---------|--------|--------|
| `app/components/RobustLibeliaOMRModal.tsx` | Tras tener `imageToRead`, intentar primero `readOMRWithAspose`; si falla o no configurado, usar `readLibelIASheetFromImage`. Mensajes UX: "Leyendo hoja con motor OMR profesional...", "Se usó lector de respaldo de LibelIA", etc. | Bajo: solo nueva rama y mensajes; compare/review/retry-save intactos. |

---

## 4. Variables de entorno necesarias

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `ASPOSE_CLIENT_ID` | Sí (para usar Aspose) | Client ID de la aplicación en [Aspose Cloud Dashboard](https://dashboard.aspose.cloud/). |
| `ASPOSE_CLIENT_SECRET` | Sí (para usar Aspose) | Client Secret de la aplicación. |
| `ASPOSE_OMR_TEMPLATE_BASE64` | Sí (para reconocimiento) | Contenido del archivo de patrón de reconocimiento (.omr) generado en Aspose para una plantilla que coincida con la hoja LibelIA (mismo número de preguntas y opciones), codificado en base64. |

Documentación para el usuario: ver sección "Configuración y pruebas" más abajo.

---

## 5. Adaptador Aspose (resumen)

- **API route**: lee `ASPOSE_CLIENT_ID`, `ASPOSE_CLIENT_SECRET`, `ASPOSE_OMR_TEMPLATE_BASE64`; obtiene token; POST PostRecognizeTemplate con imagen (base64) y omrFile (template base64); hace polling a GetRecognizeTemplate hasta resultado o timeout; decodifica `results[0].data` y mapea a `GridReadResult[]`; responde JSON `{ success, results?: GridReadResult[], error?: string }`.
- **Cliente** (`omr-aspose-reader.ts`): recibe data URL de la imagen, numQuestions, optionLabels; convierte imagen a base64 y llama a `/api/omr/recognize-aspose`; si success, devuelve results; si no, lanza con mensaje claro (credenciales faltantes, error de red, etc.).

---

## 6. Explicación breve

Aspose.OMR Cloud se integra como **lector OMR principal** solo en el flujo robusto de hoja LibelIA. La plantilla, la clave correcta, la comparación, la nota y el análisis siguen en LibelIA; Aspose solo devuelve las marcas leídas. La salida se adapta a `GridReadResult[]` para no tocar compare, review ni retry-save. Si Aspose no está configurado o falla, se usa el lector actual de LibelIA como respaldo. No se modifican OMR antiguo, RealtimeOMRModal, TemplateOverlayOMRModal, /api/evaluate, scoring, persist-evaluation, OCR, análisis pedagógico, gráficos, diagnóstico, parsers ni flujos de informes.

---

## 7. Checklist manual

- [ ] El sistema actual sigue intacto (OMR antiguo, RealtimeOMRModal, TemplateOverlayOMRModal, /api/evaluate, scoring, persistencia, análisis, gráficos, diagnóstico, parsers, retry-save, informes).
- [ ] El flujo robusto puede usar Aspose como lector principal cuando las variables de entorno están configuradas.
- [ ] La salida del adaptador es `GridReadResult[]` compatible con compare.
- [ ] Compare, review y retry-save siguen funcionando igual.
- [ ] La plantilla OMR LibelIA (número de preguntas, opciones, clave correcta) sigue siendo la base del proceso.
- [ ] El lector actual de LibelIA se usa como fallback cuando Aspose no está configurado o falla.
- [ ] Mensajes claros: "Leyendo hoja con motor OMR profesional...", "Lectura OMR completada.", "Se usó lector de respaldo de LibelIA", errores claros si faltan credenciales.

---

## 8. Configuración y pruebas

### Credenciales

1. Crear una cuenta en [Aspose Cloud](https://dashboard.aspose.cloud/).
2. En **Applications**, crear una aplicación y anotar **Client Id** y **Client Secret**.
3. Configurar en `.env.local` (o el entorno que use Next.js):
   - `ASPOSE_CLIENT_ID=...`
   - `ASPOSE_CLIENT_SECRET=...`

### Plantilla de reconocimiento (.omr)

1. En Aspose.OMR Cloud diseñar (o generar) una plantilla que coincida con la hoja LibelIA que se usa (mismo número de preguntas y de opciones por pregunta).
2. Al generar la plantilla imprimible, descargar también el **archivo de patrón de reconocimiento** (.omr).
3. Convertir el archivo .omr a base64 (p. ej. `base64 -i template.omr -o template.b64` o herramienta equivalente).
4. Añadir en `.env.local`: `ASPOSE_OMR_TEMPLATE_BASE64=<contenido del archivo base64>` (o cargar desde fichero en el servidor si se prefiere no poner una cadena larga en .env).

### Probar la integración

1. Arrancar la app con las variables configuradas.
2. En el flujo robusto de corrección OMR LibelIA, subir una imagen de una hoja rellenada que corresponda a la plantilla configurada.
3. Verificar que aparece "Leyendo hoja con motor OMR profesional..." y luego el resultado; si Aspose falla, que aparezca "Se usó lector de respaldo de LibelIA" y el flujo continúe con compare/review/guardado.
