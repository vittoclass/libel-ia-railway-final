# Precisión avanzada — Esquinas y corrección de perspectiva (OMR plantilla superpuesta)

**Proyecto:** LibelIA  
**Objetivo:** Aumentar la precisión de lectura en el flujo OMR con plantilla superpuesta mediante detección de esquinas reales y corrección de perspectiva, sin tocar el sistema actual.

---

## FASE 1 — Auditoría técnica

### 1. Cómo funciona hoy `detectSheetInFrame()`

- Copia el frame del video a un canvas de trabajo (máx. 320 px).
- Escala de grises y umbral (≥ 175 → papel).
- Recorre todos los píxeles y actualiza **minX, minY, maxX, maxY** de los píxeles “papel”.
- No hay contorno ni orden: solo el **bounding box axis-aligned** (rectángulo alineado a ejes).
- Devuelve centro, ancho, alto, relación de aspecto y área de ese rectángulo.

### 2. Limitación de la detección actual (solo bbox)

- Con **perspectiva** la hoja es un cuadrilátero (trapecio, etc.). El bbox es el rectángulo que lo envuelve: se pierde la forma real.
- No se distinguen las **4 esquinas** ni la inclinación.
- El grid en `readGridFromImage` se aplica sobre un **recorte al aspect ratio** (centro de la imagen). Si la hoja está inclinada, ese recorte no coincide con los bordes reales de la hoja y la lectura se desplaza o deforma.
- Conclusión: para mejorar precisión hace falta **cuadrilátero (4 esquinas)** y **warp a rectángulo** antes de leer.

### 3. Información disponible para esquinas reales

- La misma imagen umbralizada (papel vs fondo) permite:
  - Obtener **píxeles de borde** (papel con al menos un vecino fondo).
  - Seguir el **contorno** del mayor blob (trazado en 8-conexo).
  - A partir del contorno, elegir **4 puntos** (p. ej. por sectores desde el centroide o por cuadrilátero de área mínima).
- No se usa OpenCV; todo en Canvas + `getImageData` en frontend.

### 4. Técnica más segura en frontend para una V1 precisa

- **Detección de bordes:** útil para encontrar candidatos a contorno; en V1 se puede trabajar directamente con la máscara binaria (umbral) y el borde de la región blanca.
- **Contorno:** trazado del borde del mayor componente conexo (8-vecinos) en la máscara binaria.
- **Aproximación a cuadrilátero:** a partir del contorno ordenado, tomar 4 puntos (p. ej. por sectores angulares desde el centroide: en cada cuadrante, el punto del contorno más lejano al centroide). Ordenar como [tl, tr, br, bl].
- **Transformación de perspectiva:** homografía 3×3 a partir de 4 correspondencias origen → destino (rectángulo con aspect ratio de la plantilla). Muestreo inverso (por cada píxel del destino, obtener (x,y) en origen y muestrear con interpolación bilinear). Todo en Canvas 2D + `getImageData`/`putImageData` o canvas auxiliar.
- **Dónde ejecutar:** la corrección de perspectiva es costosa y se hace **una vez sobre la captura** (paso preview), no frame a frame. La detección de esquinas en tiempo real (para guía) puede hacerse en resolución reducida en el paso cámara si se desea; en V1 se prioriza **precisión en la captura** y se aplica esquinas + warp solo en preview/captura.

### 5. Dónde hacer detección y corrección

- **En preview/captura (obligatorio para precisión):** sobre la imagen capturada (alta resolución) se detectan las 4 esquinas, se calcula la homografía y se genera la imagen corregida. Esa imagen es la que se pasa a `readGridFromImage`. Si la detección falla, se usa la imagen original (comportamiento actual).
- **En tiempo real (opcional V1):** se puede reutilizar la misma lógica sobre el canvas de trabajo (baja resolución) para dibujar el cuadrilátero detectado y mostrar “Esquinas detectadas” o “Corrige la inclinación”. Para no sobrecargar, en V1 se prioriza **solo corrección en captura** y, si hay tiempo, un indicador de “cuadrilátero detectado” en cámara sin warp en vivo.

---

## Estrategia elegida

1. **Nuevo módulo `app/lib/sheet-perspective.ts`** (solo usado por el flujo plantilla superpuesta):
   - **findSheetCornersFromBinary(data, width, height):** a partir de ImageData ya umbralizado (1 byte por píxel: 0 fondo, 255 papel), obtiene el contorno del mayor blob (trazado 8-conexo del borde), luego 4 esquinas por sectores desde el centroide, ordenadas [tl, tr, br, bl].
   - **getPerspectiveTransform(srcCorners, destCorners):** devuelve una matriz 3×3 (homografía) que mapea src → dest.
   - **warpPerspectiveToDataUrl(srcDataUrl, srcCorners, destWidth, destHeight):** carga la imagen, aplica la homografía inversa (destino → origen) con muestreo bilinear, devuelve dataUrl del canvas de salida.
   - **findSheetCornersAndWarp(dataUrl, templateAspectRatio, threshold):** carga imagen, grayscale + umbral, obtiene esquinas; si hay 4 válidas, calcula tamaño destino (p. ej. ancho = promedio de lados opuestos, alto = ancho / templateAspectRatio), hace warp y devuelve `{ correctedDataUrl, corners }`. Si algo falla, devuelve `null` y el modal usa la imagen original.

2. **Modal (TemplateOverlayOMRModal):**
   - En **handleConfirmCapture**, antes de `readGridFromImage`: llamar a `findSheetCornersAndWarp(pendingCaptureDataUrl, templateAspectRatio, GRAY_THRESHOLD)`. Si hay resultado, usar `correctedDataUrl` para `readGridFromImage` y guardar un flag `perspectiveCorrected` para la UI. Si no, usar `pendingCaptureDataUrl` como hasta ahora.
   - En el paso **preview**: si se aplicó corrección, mostrar el mensaje “La hoja fue corregida digitalmente para mejorar la lectura” y, si es posible, una miniatura de la imagen corregida o un indicador junto a “Usar esta foto”.
   - No se modifica trial_type, template, camera, result, review, retry-save ni la lógica solo alternativas / mixta.

3. **Prioridad burbujas:** no se añade soporte a cruces en esta fase; solo se mejora la geometría para la lectura de burbujas ya existente.

---

## Archivos nuevos

| Archivo | Descripción |
|--------|-------------|
| `app/lib/sheet-perspective.ts` | Detección de contorno, 4 esquinas desde binaria, homografía 3×3, warp con muestreo bilinear, y `findSheetCornersAndWarp` para uso en captura. |
| `AUDITORIA_PRECISION_ESQUINAS_PERSPECTIVA_OMR.md` | Este documento (auditoría + estrategia). |

---

## Archivos modificados

| Archivo | Cambio | Riesgo |
|--------|--------|--------|
| `app/components/TemplateOverlayOMRModal.tsx` | Antes de leer el grid se llama a `findSheetCornersAndWarp`; si hay imagen corregida se usa para `readGridFromImage` y se muestra aviso de corrección en preview. | Bajo: solo se añade un paso opcional antes de la lectura; si falla, se mantiene el flujo actual. |

---

## Riesgo por archivo

- **sheet-perspective.ts:** Lógica aislada; solo se usa desde el modal. Si la detección o el warp fallan, se devuelve `null` y no se rompe nada.
- **TemplateOverlayOMRModal.tsx:** Cambios acotados a la preparación de la imagen para lectura y al mensaje en preview; compare, review y guardado intactos.

---

## Checklist manual

- [ ] OMR antiguo intacto.
- [ ] Modalidad plantilla superpuesta sigue existiendo.
- [ ] El sistema ya no depende solo del bbox para la lectura cuando hay esquinas válidas.
- [ ] Se detectan 4 esquinas (o cuadrilátero) de la hoja en la captura.
- [ ] Se corrige perspectiva antes de leer cuando la detección es válida.
- [ ] La lectura se hace sobre la imagen corregida cuando existe.
- [ ] Flujo de revisión y guardado sin cambios.
- [ ] Modo solo alternativas / mixta sin cambios.
- [ ] No se rompe nada del sistema actual.

---

## Código y explicación breve

- **app/lib/sheet-perspective.ts**
  - **toBinary:** ImageData RGBA → Uint8Array binario (gris ≥ umbral → 255).
  - **findFirstBoundaryPixel:** primer píxel blanco con al menos un vecino negro (8-vecinos).
  - **traceBoundary:** seguimiento del contorno en 8-conexo (Moore) desde ese píxel; devuelve lista ordenada de puntos de borde.
  - **contourToQuad:** centroide del contorno; 4 sectores angulares (0–90°, 90–180°, …); en cada sector, punto del contorno a mayor distancia; orden [tl, tr, br, bl].
  - **findSheetCornersFromImageData:** binario → primer borde → contorno → contourToQuad; filtro por área mínima del cuadrilátero; devuelve las 4 esquinas o null.
  - **getPerspectiveTransform:** 4 pares de puntos (origen → destino); sistema lineal 8×8 para la homografía 3×3 (h22=1).
  - **warpPerspectiveToDataUrl:** carga imagen, homografía inversa (destino → origen), muestreo bilinear por píxel de salida, canvas.toDataURL().
  - **findSheetCornersAndWarp:** carga imagen, la redimensiona (máx. 640 px) para detección, encuentra esquinas, escala esquinas a resolución original, warp a rectángulo con aspect ratio de la plantilla, devuelve `{ correctedDataUrl, corners }` o null.

- **app/components/TemplateOverlayOMRModal.tsx**
  - Estado **perspectiveCorrected** (boolean).
  - En **handleConfirmCapture:** se llama a `findSheetCornersAndWarp(pendingCaptureDataUrl, templateAspectRatio, GRAY_THRESHOLD)`. Si hay resultado, se usa `correctedDataUrl` para `readGridFromImage` y se pone `perspectiveCorrected = true`; si no, se usa la imagen original.
  - En el paso **preview:** texto que indica que, si se detectan esquinas, se aplicará corrección de perspectiva.
  - En el paso **result:** si `perspectiveCorrected`, se muestra el aviso “La hoja fue corregida digitalmente para mejorar la lectura.”
  - Reset de `perspectiveCorrected` en handleClose, handleRetake y handleRepetirCaptura.
