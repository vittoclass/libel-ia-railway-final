# OMR guiado por plantilla superpuesta — Auditoría y diseño técnico

**Proyecto:** LibelIA  
**Objetivo:** Nueva modalidad de OMR con plantilla corregida real superpuesta, alineación guiada y detección posicional tipo lector óptico, sin tocar el sistema actual.

---

## 1. Auditoría técnica seria (FASE 1)

### 1.1 Representación de la plantilla corregida real

| Opción | Descripción | Viabilidad V1 |
|--------|-------------|----------------|
| **A. Imagen de plantilla resuelta** | El profesor sube una foto/escaneo de la pauta con las respuestas correctas marcadas (burbujas rellenadas). La imagen es la referencia visual y geométrica. | ✅ Elegida. Permite superponer la misma imagen en cámara y derivar la clave (vía API answer-key existente o manual). |
| **B. PDF** | Mismo concepto; se convierte la página a imagen para overlay y procesamiento. | Posible; V1 puede aceptar solo imagen para simplificar. |
| **C. Estructura derivada** | Tras cargar la imagen, un proceso extrae zonas de preguntas y alternativas (detección de burbujas). | V2: requiere OpenCV o similar; no en V1. |
| **D. Clave + coordenadas** | Lista de respuestas correctas más coordenadas explícitas por celda. | Puede generarse en V2 a partir de la imagen; en V1 usamos **grid paramétrico**. |

**Decisión:** La plantilla es una **imagen real** subida por el profesor. De ella se obtiene: (1) la **clave** (qué respuesta es correcta por pregunta), vía API `/api/omr/answer-key` existente. (2) La **geometría** en V1 es **paramétrica**: mismo aspecto que la imagen, número de preguntas, columnas (p. ej. 2) y opciones (A–D). Las posiciones de las celdas se calculan como grid sobre un rectángulo con la misma relación de aspecto que la plantilla. No se extraen coordenadas reales de burbujas en V1.

### 1.2 Carga de la plantilla

- **Flujo:** El profesor sube un archivo de imagen (plantilla resuelta). Se muestra la imagen y se llama a `POST /api/omr/answer-key` con esa imagen para obtener la clave (sin modificar ese endpoint). Se guardan en estado: `templateDataUrl`, `answerKey`, `totalPreguntas`, `opciones`, relación de aspecto de la imagen.
- **Restricción:** No tocar el backend de answer-key; solo consumirlo.

### 1.3 Uso de la geometría para superponer en cámara

- **V1:** No hay detección de esquinas de la hoja del estudiante en tiempo real. La **superposición** es: mostrar la imagen de la plantilla en **semi-transparente** sobre el video de la cámara, con **mismo aspect ratio** que la plantilla y centrada (o ajustada a un marco fijo). El profesor **alinea manualmente** la hoja del estudiante con esa overlay.
- **V2 (futuro):** Detección de contorno de la hoja (p. ej. OpenCV.js o backend), obtención de 4 esquinas, transformación de perspectiva para encajar la plantilla en esa región y feedback de “alineación correcta”.

### 1.4 Detección de alineación entre plantilla y hoja

- **V1:** No hay medición automática de alineación. Mensajes de **guía visual**: “Alinea la hoja con la plantilla”, “La plantilla está bien alineada cuando coincida con tu hoja”. Opcional: usar detección de documento (p. ej. MediaPipe) solo para mostrar “documento detectado” y habilitar captura, sin usar aún la geometría para deformar la plantilla.
- **V2:** Indicadores de buena/mala alineación a partir de coincidencia de contornos o de puntos de referencia.

### 1.5 Mapeo de posiciones (burbujas / cruces)

- **Grid paramétrico:** Con `totalPreguntas`, `columnas` (2), `opciones` (4), se define una cuadrícula lógica: tantas filas como preguntas por columna, y 4 celdas por pregunta (A–D). En la imagen capturada se asume que la hoja ocupa un rectángulo con el mismo aspect ratio que la plantilla; se recorta (p. ej. centro) a ese ratio y se divide en celdas. Cada celda corresponde a una pregunta y una opción.
- **Detección de marca:** Por celda se calcula un valor de “oscuro” (p. ej. promedio de gris o de canal oscuro). Burbuja rellenada → celda más oscura. Se considera **marcada** la opción cuya celda tenga el valor más bajo por debajo de un umbral; si ninguna lo cumple, se deja en blanco.
- **V1:** Solo **burbujas** (región rellenada = oscura). **Cruces** quedan para una fase posterior para no bajar la confiabilidad.

### 1.6 Comparación por posición física real

- Tras la lectura por celdas se obtiene un array “respuesta del estudiante” por número de pregunta (y opción elegida o vacío). La **clave** (respuesta correcta por pregunta) viene de la plantilla (answer-key). La comparación es: por cada pregunta, respuesta detectada vs respuesta correcta → correcta / incorrecta / dudosa (p. ej. lectura ambigua o doble marca). Se reutiliza la lógica de comparación existente (o la misma API compare) con ese array; no se toca el backend de compare.

### 1.7 Evitar romper el sistema actual

- **Nueva modalidad:** Un único componente/modal nuevo (p. ej. `TemplateOverlayOMRModal`), invocado desde un botón nuevo (“OMR con plantilla superpuesta” o similar). No se modifica `RealtimeOMRModal`, ni ClosedAnswerOMRModal, ni `/api/evaluate`, ni `persist-evaluation`, ni flujos actuales.
- **Persistencia:** El resultado final (alternativas corregidas, puntaje de la parte de alternativas, nota de esa parte) se envía al flujo actual vía `POST /api/evaluations/retry-save` con el mismo contrato que ya usa el sistema. Si la prueba es **mixta**, se deja claro en UI que la nota es “solo parte de alternativas” y no se presenta como nota final total de la prueba.

---

## 2. Estrategia elegida para la plantilla real

- **Fuente:** Imagen de plantilla resuelta subida por el profesor (misma que puede usarse hoy en answer-key).
- **Motivo:** Es la referencia visual real que el profesor tiene; permite superponer exactamente esa imagen en cámara; la clave se obtiene con la API actual; la geometría en V1 se resuelve con grid paramétrico sobre el aspect ratio de esa imagen.

No se usa en V1: PDF (se puede añadir después convirtiendo a imagen), ni extracción automática de coordenadas de burbujas (queda para V2).

---

## 3. V1: burbujas únicamente; cruces en fase posterior

- **V1:** Solo **burbujas** (círculos rellenados). Detección por celda: región más oscura = opción marcada. Umbral para considerar “sin respuesta”.
- **Cruces (X):** Quedan como **fase posterior o experimental**; no se implementan en V1 para priorizar robustez y no reducir confiabilidad.

---

## 4. Flujo según tipo de prueba (obligatorio)

Antes de iniciar o al cargar la plantilla se pregunta:

**¿Esta prueba es solo de alternativas?**  
- **Sí** → El sistema puede hacer el flujo OMR completo y mostrar nota/puntaje de la prueba de alternativas y guardar como evaluación de solo alternativas.  
- **No, es mixta** → El sistema **no** asume nota final total; solo captura y corrige la **parte de alternativas** y la integra al flujo mixto (guardando alternativas y, si se desea, una nota parcial “solo alternativas” sin invadir la parte de desarrollo).

En la UI se muestra claramente “Solo alternativas” vs “Mixta” y, en mixta, textos del tipo “Nota (solo parte de alternativas)” y que la nota final total no se calcula automáticamente.

---

## 5. Archivos nuevos

| Archivo | Descripción |
|---------|-------------|
| `app/components/TemplateOverlayOMRModal.tsx` | Modal de la nueva modalidad: tipo de prueba (solo/mixta), carga de plantilla (imagen + clave vía answer-key), cámara con overlay de plantilla, captura, lectura por grid en cliente, comparación, revisión de dudosas, guardado por retry-save. |
| `app/lib/omr-grid-reader.ts` | Lógica de lectura por grid paramétrico (imagen, totalPreguntas, columnas, opciones) → array de respuestas del estudiante por posición. Solo burbujas (umbral de oscuro). |

---

## 6. Archivos modificados

| Archivo | Cambio | Riesgo |
|---------|--------|--------|
| `app/EvaluatorClient.tsx` | Añadir botón/entrada “OMR con plantilla superpuesta” que abre `TemplateOverlayOMRModal`. No modificar lógica existente. | Bajo: solo nueva opción y nuevo modal. |

No se modifican: `/api/evaluate`, `/api/omr/*`, `persist-evaluation.ts`, análisis pedagógico, ni ningún flujo actual.

---

## 7. Riesgo por archivo

- **TemplateOverlayOMRModal.tsx:** Solo consume APIs existentes (answer-key, retry-save) y lógica local (grid reader, compare). No toca persistencia ni evaluación global.
- **omr-grid-reader.ts:** Cálculo en cliente; no llama a backend.
- **EvaluatorClient.tsx:** Solo añade un punto de entrada; el resto del flujo permanece igual.

---

## 8. Checklist manual

- [ ] El OMR actual sigue funcionando igual.
- [ ] Existe la nueva modalidad “OMR con plantilla superpuesta”.
- [ ] Se puede cargar una plantilla corregida real (imagen).
- [ ] La cámara muestra overlay de la plantilla y guía de alineación.
- [ ] El sistema indica si la hoja está alineada (mensaje o indicador; en V1 puede ser solo guía visual).
- [ ] La comparación se hace por posición (grid) en la imagen capturada.
- [ ] Se muestran correctas / incorrectas / dudosas.
- [ ] El profesor corrige solo lo mínimo (dudosas).
- [ ] Se pregunta si la prueba es solo de alternativas o mixta.
- [ ] Si es mixta, no se calcula nota final total automáticamente; se muestra nota solo parte alternativas.
- [ ] El resultado se integra al flujo normal (retry-save) sin romper nada.

---

## 9. Resumen

- **Plantilla:** Imagen real subida; clave vía answer-key; geometría V1 = grid paramétrico sobre el aspect ratio de la imagen.
- **Superposición:** Imagen de la plantilla en semi-transparente sobre la cámara; alineación manual en V1.
- **Lectura:** Por celdas en el cliente (grid paramétrico), solo burbujas; cruces en fase posterior.
- **Tipo de prueba:** Pregunta obligatoria “solo alternativas / mixta”; en mixta no se asume nota final total.
- **Integración:** Mismo contrato y retry-save; nueva modalidad aislada y opcional.

---

## 10. Implementación realizada

- **TemplateOverlayOMRModal.tsx:** Creado en `app/components/TemplateOverlayOMRModal.tsx` con flujo completo: trial_type → template (imagen + answer-key) → camera (overlay semi-transparente) → preview → result (compare vía `/api/omr/compare`) → review (solo dudosas) → guardado vía `/api/evaluations/retry-save`. En mixta se muestra aviso “Nota (solo parte de alternativas)”.
- **omr-grid-reader.ts:** Ya existía en `app/lib/omr-grid-reader.ts`; el modal lo usa para lectura por celdas tras la captura.
- **EvaluatorClient.tsx:** Añadidos estado `isTemplateOverlayOMROpen`, import de `TemplateOverlayOMRModal`, render del modal y botón “OMR con plantilla superpuesta” en la tarjeta de selección de modo de captura (junto a “OMR en tiempo real”).

Para validar: usar el checklist de la sección 8 manualmente en la app.
