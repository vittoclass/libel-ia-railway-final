# Auditoría y entrega: Lector OMR híbrido LibelIA

## 1. Auditoría técnica inicial

### Cómo se leía la hoja LibelIA antes

- **Archivo**: `app/lib/omr-libelia-reader.ts`
- **Flujo**: (1) `getBubblePositions(numQuestions, numOptions)` + `mmToPixel` para coordenadas exactas; (2) muestreo de papel en 8 zonas → `paperMean`; (3) umbral dinámico `dynamicThreshold = paperMean - OFFSET_OSCURIDAD`; (4) por burbuja solo `sampleCircleGray` (una sola intensidad media en el círculo); (5) por pregunta: comparación de intensidades contra ese umbral global y constantes `DELTA_DUDA`, `DELTA_MINIMO_CLARA`, `DELTA_DOBLE`.

### Dependencia de umbral global

- Toda la decisión “marcada / vacía / dudosa” dependía de:
  - Un único umbral global (`dynamicThreshold`).
  - Una sola métrica por burbuja (intensidad media en el círculo).
- Problemas: iluminación no uniforme, sombras o suciedad local no se compensan; una sola medición por burbuja es frágil.

### Integración de clasificación local por parche

- Se mantiene la geometría fija: `getBubblePositions`, `BUBBLE_RADIUS_MM`, `PAGE_*_MM`, imagen ya corregida en perspectiva.
- Por cada burbuja:
  - Se extrae un parche local (círculo + anillo alrededor).
  - Se calculan métricas locales: `meanGray`, `localBackground` (anillo), `darkRatio`, `contrast`.
  - Se clasifica la burbuja con reglas explícitas en **EMPTY** / **FILLED** / **UNCERTAIN**.
- Por pregunta: la respuesta se resuelve comparando las clases de sus opciones (FILLED único → marcada; ≥2 FILLED → doble; solo UNCERTAIN → mejor candidato con confianza baja; todas EMPTY → vacía).

### Información ya existente utilizada

- `getBubblePositions(numQuestions, numOptions)` — coordenadas exactas por burbuja.
- `BUBBLE_RADIUS_MM`, `PAGE_WIDTH_MM`, `PAGE_HEIGHT_MM` — conversión mm → píxeles.
- Imagen rectificada (perspectiva corregida) — entrada del flujo robusto.
- Clave correcta interna: sigue en el template/AnswerKeyData; el contraste con la clave lo hace quien use `GridReadResult[]` (comparación pregunta por pregunta). El lector solo devuelve respuestas detectadas; no se toca scoring ni persistencia.

---

## 2. Estrategia elegida

**Heurística local por parche (opción A).**

- Sin ML, sin dependencias nuevas.
- Por burbuja: métricas locales (media en círculo, fondo en anillo, fracción de píxeles oscuros, contraste) y reglas con constantes documentadas.
- Resolución por pregunta: contar FILLED/EMPTY/UNCERTAIN y aplicar reglas claras (una FILLED → esa opción; ≥2 FILLED → doble; solo UNCERTAIN → mejor candidato por meanGray con confianza baja; todas EMPTY → vacía).
- Todo contenido en `omr-libelia-reader.ts`; no se toca backend, scoring, persistencia, análisis pedagógico ni flujos existentes.

---

## 3. Archivos nuevos

- **`AUDITORIA_LECTOR_OMR_HIBRIDO.md`** (este documento): auditoría, estrategia, riesgos, checklist.

---

## 4. Archivos modificados

- **`app/lib/omr-libelia-reader.ts`**
  - Añadido: `sampleAnnulusGray`, `BubbleMetrics`, `analyzeBubblePatch`, `classifyBubble`, tipo `BubbleClass` y constantes de clasificación local ya existentes.
  - Cambio principal: en `readLibelIASheetFromImage` se deja de usar solo intensidad + umbral global; se calculan métricas por burbuja, se clasifica cada una y se resuelve por pregunta con FILLED/EMPTY/UNCERTAIN.
  - Eliminado en la ruta de lectura: uso de `paperMean` y `dynamicThreshold` para decidir (siguen usados solo en el overlay de debug).
  - `drawBubbleDebugOverlay`: ahora colorea cada círculo por clase (verde=FILLED, rojo=EMPTY, amarillo=UNCERTAIN) y muestra leyenda y threshold de referencia.

---

## 5. Riesgo por archivo

| Archivo | Riesgo | Notas |
|--------|--------|--------|
| `app/lib/omr-libelia-reader.ts` | Bajo | Solo se cambia la lógica interna de lectura; la firma y el tipo de retorno `Promise<GridReadResult[]>` se mantienen. Quien llama (p. ej. RobustLibeliaOMRModal) no requiere cambios. |
| `AUDITORIA_LECTOR_OMR_HIBRIDO.md` | Nulo | Solo documentación. |

No se modifican: OMR antiguo, RealtimeOMRModal, TemplateOverlayOMRModal, `/api/evaluate`, `/api/evaluate/batch`, scoring, persist-evaluation, OCR, análisis pedagógico, gráficos, diagnóstico, parsers, retry-save ni flujos de evaluación existentes.

---

## 6. Código (resumen)

- **Muestreo de fondo local**: `sampleAnnulusGray(data, width, height, cx, cy, rInner, rOuter)` promedia el gris en el anillo [rInner, rOuter] para obtener `localBackground` por burbuja.
- **Métricas por burbuja**: `analyzeBubblePatch(data, width, height, cx, cy, radiusPx)` devuelve `{ meanGray, localBackground, darkRatio, contrast }` (darkRatio = fracción de píxeles del círculo con gray ≤ localBackground - LOCAL_DARK_THRESHOLD).
- **Clasificación**: `classifyBubble(metrics)` → `"EMPTY" | "FILLED" | "UNCERTAIN"` usando `FILLED_DARK_RATIO_MIN`, `FILLED_CONTRAST_MIN`, `EMPTY_DARK_RATIO_MAX`, `EMPTY_CONTRAST_MAX`.
- **Lectura**: Para cada burbuja se llama `analyzeBubblePatch` + `classifyBubble`; por pregunta se cuentan FILLED/UNCERTAIN y se emite `{ pregunta, respuesta, confianza }` con la misma forma que antes (incl. `"DOBLE_MARCA"`, `""`, o letra de opción).
- **Debug**: `drawBubbleDebugOverlay` dibuja cada burbuja con color según clase y muestra paperMean, threshold de referencia y leyenda.

---

## 7. Explicación breve

El lector robusto de la hoja LibelIA deja de depender de un único umbral global y de una sola intensidad por burbuja. Pasa a usar geometría fija (`getBubblePositions`), parche local por burbuja (círculo + anillo), métricas locales (media, fondo local, darkRatio, contraste) y clasificación explícita (EMPTY/FILLED/UNCERTAIN). La respuesta por pregunta se obtiene comparando esas clases entre las opciones. La API pública del lector no cambia; el contraste con la clave correcta interna sigue haciéndose en los flujos que ya comparan `GridReadResult[]` con el template. No se toca nada sagrado (scoring, persistencia, análisis pedagógico, APIs de evaluación).

---

## 8. Checklist manual

- [ ] El sistema actual sigue intacto (OMR antiguo, modales no robustos, APIs, scoring, persistencia, análisis, gráficos, diagnóstico, parsers, retry-save).
- [ ] El flujo robusto sigue usando la hoja estándar LibelIA y la misma API del lector.
- [ ] La clave correcta interna sigue usándose donde ya se usaba (comparación con respuestas leídas).
- [ ] La lectura ya no depende solo de umbral global: cada burbuja usa métricas locales y clasificación EMPTY/FILLED/UNCERTAIN.
- [ ] La respuesta por pregunta se decide comparando opciones (una FILLED → esa opción; ≥2 FILLED → doble; solo UNCERTAIN → mejor candidato; todas EMPTY → vacía).
- [ ] El sistema puede mostrar correctas/incorrectas/vacías/dobles/dudosas según quien consuma `GridReadResult[]` y la clave.
- [ ] La revisión mínima sigue funcionando (los resultados siguen en el mismo formato).
- [ ] Modo debug: overlay con colores por clase (FILLED/EMPTY/UNCERTAIN) y leyenda ayuda a validar la lectura.
- [ ] No se ha roto ningún flujo ni componente prohibido en la regla de oro.
