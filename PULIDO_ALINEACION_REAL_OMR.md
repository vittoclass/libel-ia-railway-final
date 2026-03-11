# Pulido final — Alineación real OMR plantilla superpuesta

**Proyecto:** LibelIA  
**Objetivo:** Hacer la alineación real más clara, profesional y confiable: bbox visual, semáforo y umbrales consolidados.

---

## FASE 1 — Auditoría breve del estado actual

### 1. Cómo se calcula `detectSheetInFrame()`

- Se copia el frame del video a un canvas de trabajo redimensionado (lado máximo 320 px).
- Escala de grises por píxel: `0.299*R + 0.587*G + 0.114*B`.
- Umbral: píxeles con `gray >= GRAY_THRESHOLD` (175) se consideran “hoja”.
- Se obtiene el bounding box (minX, minY, maxX, maxY) de todos esos píxeles.
- Se filtra: al menos 100 píxeles, `areaRatio >= MIN_SHEET_AREA_RATIO` (0.05), y bbox válido.
- Se devuelve: `center`, `width`, `height`, `aspectRatio`, `areaRatio` (en coords del canvas de trabajo).

### 2. Qué devuelve exactamente

- **Si no hay hoja:** `null`.
- **Si hay hoja:** `SheetDetection`: `{ center: {x,y}, width, height, aspectRatio, areaRatio }`. Las coordenadas son del canvas de trabajo (p. ej. 320×240).

### 3. Cómo se calcula `getAlignmentFeedback()`

- **Sin detección:** score 0, mensaje "Coloca la hoja dentro del marco", ready false.
- **Con detección:** se compara con el marco esperado (centro del frame = viewWidth/2, viewHeight/2; relación de aspecto = plantilla).
  - Distancia del centro al centro del frame (normalizada por diagonal).
  - Diferencia de relación de aspecto.
  - Área dentro de rango (AREA_MIN_RATIO … AREA_MAX_RATIO).
  - Score = 0.4×centerScore + 0.4×aspectScore + 0.2×areaScore.
  - `ready = score >= ALIGN_READY_SCORE` (0.7).

### 4. Qué información visual falta hoy

- No se dibuja el bbox detectado: el profesor no ve qué región se considera “hoja”.
- No hay indicador rápido de estado (semáforo): solo texto.
- No se distingue visualmente “mala / aceptable / lista” de un vistazo.

### 5. Umbrales actuales

| Constante | Valor | Uso |
|-----------|--------|-----|
| `GRAY_THRESHOLD` | 175 | Píxel ≥ este valor → papel. Por debajo se considera fondo. |
| `MIN_SHEET_AREA_RATIO` | 0.05 | Mínima fracción del frame que debe ocupar la hoja para contar como detectada. |
| `MAX_WORK_SIZE` | 320 | Lado máximo del canvas de trabajo (rendimiento). |
| `ALIGN_READY_SCORE` | 0.7 | Umbral de puntuación para permitir captura. |
| `CENTER_TOLERANCE_NORM` | 0.15 | Tolerancia de descentrado (fracción de la diagonal). |
| `ASPECT_TOLERANCE` | 0.12 | Tolerancia de diferencia de relación de aspecto. |
| `AREA_MIN_RATIO` | 0.15 | Área mínima de la hoja (evita “muy lejos”). |
| `AREA_MAX_RATIO` | 0.92 | Área máxima (evita recortes). |

---

## Archivos nuevos

Ninguno (solo modificaciones).

---

## Archivos modificados

| Archivo | Cambio |
|--------|--------|
| `app/lib/sheet-alignment.ts` | Constantes documentadas y exportadas; función `drawDetectionOverlay()` para dibujar el bbox en un canvas overlay con color según estado (rojo/amarillo/verde). |
| `app/components/TemplateOverlayOMRModal.tsx` | Canvas overlay sobre el video; en el tick se llama a `drawDetectionOverlay`; semáforo (badge rojo/amarillo/verde) y mensajes claros. |

---

## Riesgo por archivo

- **sheet-alignment.ts:** Solo se añade documentación, export de constantes y una función de dibujo; la lógica de detección y feedback no cambia.
- **TemplateOverlayOMRModal.tsx:** Solo se añade UI (overlay + semáforo) y la llamada al dibujo; el flujo y el resto de pasos se mantienen.

---

## Checklist manual

- [ ] OMR antiguo intacto.
- [ ] Modalidad plantilla superpuesta sigue existiendo.
- [ ] La cámara muestra visualmente la detección (bbox).
- [ ] Existe semáforo/indicador visual de alineación.
- [ ] Mensajes siguen siendo claros.
- [ ] Botón Capturar bloqueado si la alineación no es suficiente.
- [ ] Umbrales claros y ajustables.
- [ ] No se rompe el flujo nuevo ni el sistema actual.

---

## Código y explicación breve

- **sheet-alignment.ts**
  - Constantes exportadas (`GRAY_THRESHOLD`, `ALIGN_READY_SCORE`, etc.) para poder ajustar umbrales en un solo lugar.
  - `drawDetectionOverlay(overlayCanvas, detected, feedback, workW, workH, displayW, displayH, videoWidth, videoHeight)`: calcula el rectángulo de la hoja en coordenadas de pantalla (respetando object-contain del video), pinta el bbox con relleno suave y borde; color verde si `feedback.ready`, amarillo si `score >= 0.4` y no listo, rojo si no.

- **TemplateOverlayOMRModal.tsx**
  - Canvas overlay con `ref={overlayCanvasRef}` encima del video (`pointer-events-none`), mismo tamaño que el contenedor.
  - En el bucle de detección, después de `getAlignmentFeedback` se llama a `drawDetectionOverlay` con el canvas overlay, la detección, el feedback y las dimensiones del trabajo y del video.
  - Semáforo: badge con punto de color (verde / amarillo / rojo) y etiqueta “Lista para capturar” / “Ajusta un poco más” / “Mala alineación”, más el mensaje detallado debajo.
