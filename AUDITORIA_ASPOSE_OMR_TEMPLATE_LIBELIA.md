# Auditoría: generación automática de plantilla Aspose (.omr) desde hoja LibelIA

## 1. Auditoría técnica

### Traducción hoja LibelIA → markup Aspose

- La hoja LibelIA tiene: número de preguntas (`numQuestions`), número de opciones por pregunta (`numOptions`, 4 o 5), layout en 2 columnas, opciones A–D o A–E.
- Aspose.OMR Cloud acepta **JSON markup** con estructura: `Template` → `children` → `Page` → `children` → contenido.
- El elemento **AnswerSheet** encaja con el uso LibelIA: matriz de burbujas numeradas, varias columnas, mismo número de respuestas por pregunta.
  - `element_type: "AnswerSheet"`
  - `elements_count`: numQuestions
  - `columns_count`: 2 (equivalente a 2 columnas LibelIA)
  - `answers_count`: numOptions (4 o 5)
  - `answers_list`: `["A","B","C","D"]` o `["A","B","C","D","E"]`
  - `name`: identificador para resultados (p. ej. "LibelIA").

### Formato: JSON markup

- Se usa **JSON markup** (no text markup): más fácil de generar desde código y documentado en Aspose (element_type, children, Page, AnswerSheet).

### Estructura de preguntas y respuestas para Aspose

- Un solo **AnswerSheet** con `elements_count` = total de preguntas, `answers_count` = opciones por pregunta, `answers_list` = etiquetas. Aspose numera las filas (1, 2, …) y devuelve en reconocimiento elementos por nombre/fila; el mapeo a `GridReadResult[]` (pregunta 1..N, respuesta A–E) ya está resuelto en el adaptador de reconocimiento.

### Cómo guardar el .omr junto con la plantilla interna

- Extender **OMRTemplate** con `asposeOmrBase64?: string`.
- Al generar la plantilla Aspose (PostGenerateTemplate → GetGenerateTemplate), se obtiene el resultado con `type: "Omr"` y `data` en base64. Ese valor se guarda en la plantilla LibelIA como `asposeOmrBase64` y se persiste en el store actual (localStorage).

---

## 2. Archivos nuevos

| Archivo | Descripción |
|---------|-------------|
| `app/lib/omr-aspose-template-generator.ts` | Construye el JSON markup de Aspose (Template → Page → Text + AnswerSheet) a partir de numQuestions, numOptions y nombre. |
| `app/api/omr/generate-aspose-template/route.ts` | POST: recibe numQuestions, numOptions, templateId, name; construye markup; llama a PostGenerateTemplate; hace polling a GetGenerateTemplate; devuelve omrBase64 (y opcionalmente printable form). |
| `AUDITORIA_ASPOSE_OMR_TEMPLATE_LIBELIA.md` | Este documento. |

---

## 3. Archivos modificados

| Archivo | Cambio | Riesgo |
|---------|--------|--------|
| `app/lib/omr-template-store.ts` | Añadir `asposeOmrBase64?: string` a `OMRTemplate`. Mantener compatibilidad con plantillas existentes (campo opcional). | Bajo. |
| `app/components/OMRSheetGeneratorModal.tsx` | Al guardar plantilla (variante clave), si Aspose está configurado, llamar a `/api/omr/generate-aspose-template`, y si hay éxito actualizar la plantilla con `asposeOmrBase64` y volver a guardar. | Bajo: flujo aditivo; si la generación falla se deja la plantilla sin .omr. |
| `app/api/omr/recognize-aspose/route.ts` | Aceptar `omrBase64` opcional en el cuerpo; si viene en la petición usarlo, si no usar `ASPOSE_OMR_TEMPLATE_BASE64` de env. | Bajo. |
| `app/lib/omr-aspose-reader.ts` | Permitir pasar `omrBase64` opcional (de la plantilla seleccionada); incluirlo en la petición a la API. | Bajo. |
| `app/components/RobustLibeliaOMRModal.tsx` | Al llamar a `readOMRWithAspose`, pasar `selectedTemplate?.asposeOmrBase64` para que la API use el .omr de la plantilla cuando exista. | Bajo. |

---

## 4. Explicación breve

LibelIA puede **generar automáticamente** la plantilla Aspose (.omr) a partir de su hoja estándar: se construye JSON markup con AnswerSheet (numQuestions, 2 columnas, numOptions, A–D/E), se llama a PostGenerateTemplate y se obtiene el .omr vía GetGenerateTemplate. Ese .omr se guarda en la plantilla OMR como `asposeOmrBase64`. En el flujo robusto, si la plantilla tiene `asposeOmrBase64` se usa directamente en PostRecognizeTemplate; si no, se usa el valor de env como respaldo. No se toca OMR antiguo, evaluate, scoring, persistencia, análisis pedagógico ni el resto de flujos.

---

## 5. Checklist manual

- [ ] El sistema actual sigue intacto.
- [ ] LibelIA puede generar plantilla Aspose .omr automáticamente (vía API y generador de markup).
- [ ] El .omr queda guardado en la plantilla OMR (`asposeOmrBase64`).
- [ ] El flujo robusto usa ese .omr guardado cuando está presente.
- [ ] Compare, review y retry-save siguen funcionando.
- [ ] No se rompe nada del sistema actual.
