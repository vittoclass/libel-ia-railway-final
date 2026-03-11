# Lectura OMR por coordenadas conocidas — Hoja estándar LibelIA

**Proyecto:** LibelIA  
**Objetivo:** Hacer que la modalidad OMR con plantilla superpuesta lea burbujas usando las coordenadas exactas de la hoja OMR estándar LibelIA, sin tocar OMR antiguo ni el resto del sistema.

---

## FASE 1 — Auditoría técnica

### 1. Cómo se lee hoy en TemplateOverlayOMRModal

- Tras la corrección de perspectiva (findSheetCornersAndWarp), la imagen a leer se pasa a **readGridFromImage(imageToRead, templateAspectRatio, { totalPreguntas, columnas: 2, opciones })**.
- readGridFromImage hace un **recorte al aspect ratio** (centro de la imagen) y divide el rectángulo en una **cuadrícula uniforme** (numRows × numCols con celdas de tamaño cellW × cellH).
- Para cada pregunta, toma la **mitad central** de cada celda (cx ± cellW/4, cy ± cellH/4), promedia el gris y considera “marcada” la opción con **menor intensidad** por debajo de un umbral fijo (180). No usa la geometría real de la hoja LibelIA.

### 2. readGridFromImage hoy

- Usa un **grid genérico**: asume que las celdas están igualmente espaciadas y que el recorte al aspect ratio coincide con el área útil. No conoce INNER_*, BUBBLE_RADIUS_MM ni getBubblePositions().
- La posición de cada “burbuja” se infiere solo por índice de fila/columna en una cuadrícula regular.

### 3. Integración de getBubblePositions() y omr-sheet-spec.ts

- **omr-sheet-spec.ts** define: INNER_LEFT_MM, INNER_TOP_MM, INNER_WIDTH_MM, INNER_HEIGHT_MM, BUBBLE_RADIUS_MM (2 mm), **getBubblePositions(numQuestions, numOptions)** que devuelve el **centro (cx, cy) en mm** de cada burbuja (q, optionIndex) en espacio **página** (0..PAGE_WIDTH_MM, 0..PAGE_HEIGHT_MM).
- La imagen rectificada por findSheetCornersAndWarp es la **hoja completa** (cuadrilátero detectado → rectángulo destWidth×destHeight con templateAspectRatio). Por tanto el mapeo es: **píxel x = (cx / PAGE_WIDTH_MM) * imageWidth**, **píxel y = (cy / PAGE_HEIGHT_MM) * imageHeight**. Radio en píxeles: **BUBBLE_RADIUS_MM * min(scaleX, scaleY)** con scaleX/Y = imageWidth/PAGE_WIDTH_MM, imageHeight/PAGE_HEIGHT_MM.
- Así se pasa de “imagen corregida” a “lectura por coordenadas fijas” usando la especificación oficial.

### 4. Parámetros para marcada / vacía / dudosa / doble marca

- **Marcada:** la burbuja tiene intensidad media ≤ UMBRAL_OSCURIDAD (ej. 180). Además, para considerarla “clara”, la diferencia entre la opción más oscura y la siguiente debe ser ≥ DELTA_MINIMO_CLARA (ej. 25).
- **Vacía:** ninguna burbuja de la pregunta supera el umbral (todas claras).
- **Dudosa:** una burbuja por debajo del umbral pero la diferencia con la segunda es < DELTA_MINIMO_CLARA → se devuelve esa opción con confianza baja para revisión.
- **Doble marca:** dos o más burbujas por debajo del umbral → respuesta "DOBLE_MARCA" para que compare/requierenRevision la marquen.

### 5. Constantes visibles

- UMBRAL_OSCURIDAD, DELTA_MINIMO_CLARA (y opcionalmente confianza alta/baja) en **omr-libelia-reader.ts** como constantes exportadas o documentadas en cabecera.

---

## Estrategia elegida

1. **Nuevo módulo `app/lib/omr-libelia-reader.ts`** (solo usado por el flujo plantilla superpuesta):
   - Importar getBubblePositions, INNER_LEFT_MM, INNER_TOP_MM, INNER_WIDTH_MM, INNER_HEIGHT_MM, BUBBLE_RADIUS_MM desde omr-sheet-spec.
   - **readLibelIASheetFromImage(dataUrl, numQuestions, numOptions, optionLabels)**:
     - Carga la imagen en canvas, obtiene ImageData.
     - Para cada burbuja de getBubblePositions, convierte (cx, cy) mm → (px, py) píxeles, muestrea en un círculo de radio BUBBLE_RADIUS_MM escalado a píxeles y calcula intensidad media.
   - Por pregunta: ordenar opciones por intensidad (ascendente). Aplicar reglas: si dos o más ≤ UMBRAL → "DOBLE_MARCA"; si ninguna ≤ UMBRAL → "" (SIN_RESPUESTA); si una ≤ UMBRAL y delta ≥ DELTA_MINIMO → opción con confianza alta; si una ≤ UMBRAL y delta < DELTA_MINIMO → opción con confianza baja (dudosa).
   - Devolver el mismo formato que readGridFromImage: **{ pregunta, respuesta, confianza }[]** para no cambiar compare ni review.

2. **TemplateOverlayOMRModal**:
   - Tras obtener **imageToRead** (original o corregida), llamar **readLibelIASheetFromImage(imageToRead, answerKey.length, optionsList.length, optionsList)** en lugar de readGridFromImage. El resto (compare, result, review, retry-save) se mantiene igual.

3. **Solo en hoja LibelIA:** Esta lectura se usa únicamente en el modal de plantilla superpuesta (flujo “hoja estándar LibelIA”). No se sustituye readGridFromImage en RealtimeOMRModal ni en otros flujos.

4. **Debug (opcional):** Función **drawBubbleDebugOverlay(canvas, dataUrl, numQuestions, numOptions)** que dibuja los círculos de lectura sobre la imagen para validar que las posiciones coinciden con la hoja.

---

## Archivos nuevos

| Archivo | Descripción |
|--------|-------------|
| `app/lib/omr-libelia-reader.ts` | Lectura por coordenadas: getBubblePositions, mm→px, muestreo por burbuja, reglas marcada/vacía/dudosa/doble, constantes documentadas. Opcional: drawBubbleDebugOverlay. |
| `AUDITORIA_LECTURA_OMR_COORDENADAS_LIBELIA.md` | Este documento. |

---

## Archivos modificados

| Archivo | Cambio | Riesgo |
|--------|--------|--------|
| `app/components/TemplateOverlayOMRModal.tsx` | Sustituir readGridFromImage por readLibelIASheetFromImage al procesar la captura. Opcional: botón o flag para mostrar overlay de debug de burbujas en preview. | Bajo: solo cambia la fuente de studentAnswers; compare, review y guardado intactos. |

---

## Riesgo por archivo

- **omr-libelia-reader.ts:** Solo importa omr-sheet-spec y no modifica APIs ni persistencia. Si falla, el modal puede capturar el error y mostrar mensaje o reintentar con readGridFromImage como fallback si se desea.
- **TemplateOverlayOMRModal.tsx:** Cambio acotado a la llamada al lector; no se tocan trial_type, compare, review ni retry-save.

---

## Resumen de implementación

- **omr-libelia-reader.ts:** Lee la imagen rectificada con `getBubblePositions()`, mapeo mm→px al área interior, muestreo en círculo por burbuja, reglas con constantes (UMBRAL_OSCURIDAD, DELTA_MINIMO_CLARA, etc.) y devuelve `GridReadResult[]` compatible con compare. Incluye `drawBubbleDebugOverlay()` para debug.
- **TemplateOverlayOMRModal:** Usa `readLibelIASheetFromImage()` como lectura principal; si falla, hace fallback a `readGridFromImage()`. En preview, botón opcional "Ver zonas de lectura (debug)" que dibuja los círculos de burbujas sobre la imagen.
- **Compare y flujo:** Sin cambios. Se envían `respuesta` vacía → "SIN_RESPUESTA", "DOBLE_MARCA" para doble marca; confianza baja marca `requierenRevision`.

---

## Checklist manual (validar tras desplegar)

- [ ] El OMR antiguo sigue intacto (no se tocó RealtimeOMRModal ni rutas antiguas).
- [ ] La modalidad nueva con hoja LibelIA (plantilla superpuesta) sigue existiendo.
- [ ] Después de corregir perspectiva, la lectura usa coordenadas exactas del formato LibelIA (getBubblePositions + mm→px).
- [ ] La detección ya no depende solo de heurísticas genéricas en este flujo (se usa el lector LibelIA).
- [ ] Cada pregunta se resuelve comparando las zonas reales de sus burbujas (muestreo en círculo por posición).
- [ ] El sistema clasifica marcada / vacía / doble / dudosa (constantes documentadas en omr-libelia-reader.ts).
- [ ] La revisión manual sigue funcionando (requierenRevision, revisión y retry-save).
- [ ] No se rompe el flujo solo alternativas / mixta.
- [ ] No se rompe nada del sistema actual (scoring, /api/evaluate, persist-evaluation, análisis pedagógico, etc.).
