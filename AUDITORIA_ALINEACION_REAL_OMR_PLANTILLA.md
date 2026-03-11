# Alineación real en tiempo real — OMR plantilla superpuesta

**Proyecto:** LibelIA  
**Objetivo:** Mejorar el flujo de OMR con plantilla superpuesta para que la cámara guíe y alinee en tiempo real de forma real hasta que la hoja encaje con la plantilla, sin romper nada.

---

## FASE 1 — Auditoría técnica

### 1. Cómo se muestra hoy la plantilla

- En `TemplateOverlayOMRModal.tsx` (paso `camera`): la plantilla se muestra como una **imagen estática** dentro de un `div` con `style={{ aspectRatio: templateAspectRatio, maxWidth: "90%", maxHeight: "90%" }}`, centrada sobre el video con `opacity-40`. Es un overlay **fijo** en el centro del encuadre; no se mueve ni se deforma con la hoja.

### 2. Si hoy hay detección real de alineación

- **No.** Solo hay un texto fijo: "Alinea la hoja con la plantilla". No se analiza el frame de la cámara ni se compara la geometría de la hoja con la plantilla. El botón "Capturar" está siempre habilitado.

### 3. Información geométrica existente de la plantilla

- **Solo:** `templateAspectRatio` (ratio ancho/alto de la imagen de plantilla). No hay esquinas, ni coordenadas de burbujas, ni cuadrilátero de referencia. El grid en `omr-grid-reader.ts` se calcula de forma paramétrica a partir de ese ratio y del recorte al aspect ratio de la imagen capturada.

### 4. Puntos o referencias para alinear

- **Marco esperado:** rectángulo centrado en el frame con relación de aspecto = `templateAspectRatio` (el mismo que el overlay actual).
- **Hoja del estudiante:** en el frame puede detectarse como una región diferenciada (más clara que el fondo). De esa región se pueden obtener:
  - **Bounding box** (centro, ancho, alto, relación de aspecto) — viable en frontend con Canvas + getImageData, sin OpenCV.
  - **Cuadrilátero (4 esquinas)** — requiere detección de contornos y aproximación a polígono; posible en JS puro o con opencv-ts (ya en el proyecto pero no usado en este flujo).

### 5. Forma más segura de implementar alineación real en V2 sin romper nada

- **Enfoque elegido:** detección en **frontend**, solo dentro del flujo de plantilla superpuesta, sin tocar APIs ni persistencia.
- **Detección:** usar **Canvas 2D + getImageData** en un canvas auxiliar (frame de video copiado, posiblemente reducido para rendimiento). Escala de grises + umbral para separar papel (claro) vs fondo (oscuro). Obtener el **bounding box** de la región “hoja” (p. ej. mayor componente conexa blanca o bbox de todos los píxeles por encima del umbral). De ahí: centro, ancho, alto, relación de aspecto.
- **Comparación:** comparar con el rectángulo esperado (centro = centro del frame, relación de aspecto = `templateAspectRatio`). Calcular:
  - Desplazamiento del centro (para mensajes “mueve a la izquierda/derecha/arriba/abajo”).
  - Diferencia de relación de aspecto y/o tamaño (para “acerca/aleja”, “inclina menos” si en el futuro se añade ángulo).
- **Guía:** un único estado (`alignmentMessage`, `alignmentScore`, `alignmentReady`) actualizado en un bucle (requestAnimationFrame o setInterval) mientras la cámara está activa. Mensajes claros y deshabilitar “Capturar” hasta que `alignmentReady` sea verdadero (o mostrar advertencia fuerte si se permite capturar con mala alineación).
- **Riesgo mínimo:** toda la lógica nueva vive en un archivo de utilidades (`sheet-alignment.ts`) y en el modal; si la detección falla (p. ej. luz mala, sin hoja), se degrada a “La hoja no se detecta” y se mantiene el botón Capturar deshabilitado o con advertencia, sin romper el resto del flujo.

---

## Estrategia concreta elegida

1. **Nuevo módulo `app/lib/sheet-alignment.ts`**
   - `detectSheetInFrame(video, canvasWork, opts)`: dibuja el frame en `canvasWork`, reduce tamaño si hace falta, grayscale + threshold, obtiene bbox de la hoja (o del mayor blob blanco). Devuelve `{ center, width, height, aspectRatio } | null`.
   - `getAlignmentFeedback(detected, viewWidth, viewHeight, templateAspectRatio)`: calcula puntuación 0–1 y mensaje de guía (ej. “Centra la hoja”, “Acércate un poco”, “Alineación correcta. Puedes capturar.”). `ready: boolean` cuando la puntuación supera un umbral.

2. **Cambios solo en `TemplateOverlayOMRModal.tsx`**
   - En el paso `camera`: ref a canvas oculto para análisis; bucle (requestAnimationFrame) que llama a `detectSheetInFrame` y `getAlignmentFeedback`, actualiza estado (`alignmentMessage`, `alignmentScore`, `alignmentReady`).
   - UI: mostrar el mensaje de alineación en tiempo real; deshabilitar “Capturar” si `!alignmentReady`; opcionalmente dibujar el bbox detectado sobre el video para feedback visual.
   - En paso `preview`: si la foto fue capturada con alineación insuficiente (guardamos `captureAlignmentReady` en el momento de capturar), mostrar advertencia “La captura no cumple el nivel mínimo de alineación. Intenta nuevamente.” y destacar “Repetir captura”.

3. **No tocar:** trial_type, template, answer-key, compare, review, retry-save, lógica mixta/solo alternativas, APIs, persist-evaluation, OMR antiguo.

---

## Archivos nuevos

| Archivo | Descripción |
|--------|-------------|
| `app/lib/sheet-alignment.ts` | Detección de hoja en frame (grayscale, threshold, bbox) y cálculo de feedback de alineación (score, mensaje, ready). |
| `AUDITORIA_ALINEACION_REAL_OMR_PLANTILLA.md` | Este documento (auditoría + estrategia). |

---

## Archivos modificados

| Archivo | Cambio | Riesgo |
|--------|--------|--------|
| `app/components/TemplateOverlayOMRModal.tsx` | Añadir bucle de detección en paso cámara, estado de alineación, mensajes en tiempo real, deshabilitar Capturar si no hay alineación suficiente, advertencia en preview si captura con mala alineación. | Bajo: solo mejora del flujo ya aislado; no se modifican APIs ni flujos antiguos. |

---

## Riesgo por archivo

- **sheet-alignment.ts:** Lógica autónoma; solo se usa desde el modal. Si falla, se devuelve `null` o `ready: false` y el usuario sigue pudiendo repetir o intentar de nuevo.
- **TemplateOverlayOMRModal.tsx:** Cambios acotados al paso cámara y al paso preview; trial_type, template, result, review, done y guardado permanecen igual.

---

## Checklist manual

- [ ] El OMR antiguo sigue intacto.
- [ ] El flujo nuevo de plantilla superpuesta sigue existiendo.
- [ ] La cámara ya no solo muestra overlay estático; hay guía en tiempo real.
- [ ] El sistema detecta la hoja y muestra mensajes (Centra, Acércate, Alineación correcta, etc.).
- [ ] Solo permite avanzar a captura cuando la alineación es suficiente, o avisa claramente.
- [ ] En preview, si la captura fue con mala alineación, se muestra advertencia y se recomienda repetir.
- [ ] La lectura ocurre después de una captura bien alineada (flujo igual que antes).
- [ ] No se rompe la lógica de pruebas mixtas / solo alternativas.
- [ ] No se rompe nada del sistema actual.

---

## Código y explicación breve

- **`app/lib/sheet-alignment.ts`:**  
  - `detectSheetInFrame(video, workCanvas)`: copia el frame del video al canvas (reducido a 320px máximo), convierte a escala de grises, umbral 175 para papel vs fondo, calcula el bounding box de los píxeles claros y devuelve centro, ancho, alto, relación de aspecto y área relativa. Si no hay región suficiente, devuelve `null`.  
  - `getAlignmentFeedback(detected, viewW, viewH, templateAspectRatio)`: compara centro (distancia al centro del frame), relación de aspecto (vs plantilla) y tamaño (área mínima/máxima). Calcula puntuación 0–1; si ≥ 0,7 se considera listo. Devuelve mensaje de guía (“Centra la hoja”, “Acércate un poco”, “Alineación correcta. Puedes capturar.”, etc.).

- **`app/components/TemplateOverlayOMRModal.tsx`:**  
  - Canvas de trabajo offscreen (`canvasWorkRef`) creado en un `useEffect` cuando `step === "camera"`. Bucle `requestAnimationFrame` que llama a `detectSheetInFrame` y `getAlignmentFeedback` y actualiza `alignmentMessage`, `alignmentScore`, `alignmentReady`.  
  - En la UI de cámara: se muestra el mensaje en la barra inferior del overlay; si `!alignmentReady` se muestra “La hoja aún no coincide con la plantilla…” y el botón “Capturar” está deshabilitado; si `alignmentReady` se muestra “Alineación suficiente. Puedes capturar.” y el botón se habilita.  
  - Al capturar se guarda `captureAlignmentReady`. En el paso de vista previa, si `!captureAlignmentReady` se muestra la advertencia: “La captura no cumple el nivel mínimo de alineación. Intenta nuevamente.”  
  - Al cerrar el modal se resetean los estados de alineación.
