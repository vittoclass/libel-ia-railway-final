# Calibración automática de umbral — Lector OMR hoja LibelIA

**Proyecto:** LibelIA  
**Objetivo:** Ajustar automáticamente el umbral de oscuridad según la imagen capturada para mejorar la precisión en distintas iluminaciones, sin tocar OMR antiguo ni APIs.

---

## 1. Auditoría breve

- **Antes:** Se usaba una constante fija `UMBRAL_OSCURIDAD = 180`. En fotos oscuras, papel gris o lápiz claro la lectura podía fallar.
- **Ahora:** Se estima la intensidad media del papel en la propia imagen y se calcula un umbral dinámico `dynamicThreshold = paperMean - OFFSET_OSCURIDAD`, con fallback a `UMBRAL_OSCURIDAD_FALLBACK` si la estimación no es válida.
- **Alcance:** Solo se modifica `app/lib/omr-libelia-reader.ts`. Compare, review, retry-save y el formato `GridReadResult[]` no cambian.

---

## 2. Estrategia para estimar el papel

- Se definen **PAPER_SAMPLE_COUNT** posiciones fijas en mm en zonas de fondo de la hoja:
  - Cabecera (encima de las preguntas): centro y laterales.
  - Entre filas de preguntas: línea entre primera y segunda fila, evitando burbujas.
- En cada posición se muestrea un círculo pequeño (**PAPER_SAMPLE_RADIUS_MM = 1.5 mm**) y se promedia la intensidad (gris).
- **paperMean** = media de esas muestras. Si la imagen es muy oscura o la estimación falla, se usa **UMBRAL_OSCURIDAD_FALLBACK**.

---

## 3. Cambios en omr-libelia-reader.ts

| Cambio | Descripción |
|--------|-------------|
| Constantes de calibración | `PAPER_SAMPLE_COUNT`, `OFFSET_OSCURIDAD`, `MIN_THRESHOLD`, `DELTA_DUDA`, `DELTA_DOBLE`; `UMBRAL_OSCURIDAD` → `UMBRAL_OSCURIDAD_FALLBACK`. |
| `getPaperSamplePositionsMm()` | Devuelve 8 puntos (mm) en cabecera y entre filas para muestreo del fondo. |
| `getPaperMean()` | Muestrea esas zonas en la imagen y devuelve la intensidad media del papel. |
| Umbral dinámico | `dynamicThreshold = max(MIN_THRESHOLD, paperMean - OFFSET_OSCURIDAD)`; si no es válido, se usa el fallback. |
| Clasificación | Marcada: `gray <= dynamicThreshold`. Dudosa: zona `(dynamicThreshold - DELTA_DUDA, dynamicThreshold]` o delta pequeño entre opciones. Doble marca: dos o más por debajo del umbral (o dentro de `DELTA_DOBLE` si se configura). |
| Debug overlay | Muestra `paperMean` y `threshold` en la esquina del canvas. |

---

## 4. Riesgo por archivo

- **omr-libelia-reader.ts:** Único archivo tocado. La API pública (`readLibelIASheetFromImage` → `Promise<GridReadResult[]>`) y la firma de `drawBubbleDebugOverlay` se mantienen. Si la estimación del papel falla, se usa el umbral fijo; el flujo no se rompe.

---

## 5. Código

Los cambios están en `app/lib/omr-libelia-reader.ts`:

- Imports añadidos: `INNER_LEFT_MM`, `INNER_TOP_MM`, `INNER_WIDTH_MM`, `HEADER_HEIGHT_MM`, `ROW_HEIGHT_MM` para posiciones de muestreo.
- Nuevas constantes exportadas: `PAPER_SAMPLE_COUNT`, `OFFSET_OSCURIDAD`, `MIN_THRESHOLD`, `DELTA_DUDA`, `DELTA_DOBLE`, `UMBRAL_OSCURIDAD_FALLBACK`.
- Funciones internas: `getPaperSamplePositionsMm()`, `getPaperMean()`.
- En `readLibelIASheetFromImage`: cálculo de `paperMean` y `dynamicThreshold` antes del bucle de burbujas; clasificación con umbral dinámico y banda dudosa.
- En `drawBubbleDebugOverlay`: mismo cálculo de paper/threshold y dibujo de texto con `paperMean` y `threshold`.

---

## 6. Explicación breve

Por cada imagen rectificada se muestrean varias zonas de fondo (cabecera y entre filas) para obtener la intensidad media del papel. Con eso se define un umbral por imagen: **paperMean - OFFSET_OSCURIDAD**. Una burbuja se considera marcada si su intensidad está por debajo de ese umbral; si está justo en la frontera (banda `DELTA_DUDA`) o la diferencia con la siguiente opción es pequeña, se marca como dudosa para revisión. Así la lectura se adapta a fotos oscuras, papel gris o lápiz claro sin cambiar compare ni review.

---

## 7. Checklist manual

- [ ] OMR antiguo intacto (no se tocó).
- [ ] Flujo LibelIA (plantilla superpuesta) sigue igual.
- [ ] La lectura usa umbral dinámico (paperMean y OFFSET_OSCURIDAD).
- [ ] En distintas iluminaciones la detección mejora o se mantiene estable.
- [ ] Compare y review siguen funcionando (mismo `GridReadResult[]`).
- [ ] En "Ver zonas de lectura (debug)" se ven `paperMean` y `threshold` en la imagen.
