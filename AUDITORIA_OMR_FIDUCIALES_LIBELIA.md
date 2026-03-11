# Auditoría y entrega: OMR de nivel superior con fiduciales ArUco — LibelIA

## 1. Auditoría técnica inicial

### Cómo se generan hoy los marcadores de la hoja LibelIA

- **Archivo**: `app/lib/omr-sheet-pdf.ts`
- **Función**: `drawMarkers(doc)` dibuja **4 cuadrados negros sólidos** de 12×12 mm en las esquinas del área de contenido (márgenes 15 mm, contenido 180×267 mm). Posiciones: `[MARGIN, MARGIN]`, esquina superior derecha, inferior derecha, inferior izquierda.
- **Especificación**: `app/lib/omr-sheet-spec.ts` define `getMarkerCorners()` (centros de los 4 marcadores), `MARKER_SIZE_MM`, `LIBELIA_OMR_ASPECT_RATIO`, etc.
- No hay ningún patrón codificado: los marcadores son solo cuadrados negros, sin ID ni estructura interna.

### Cómo se detecta hoy la hoja en el flujo robusto

- **Archivo**: `app/lib/sheet-perspective.ts`
- **Método**: Detección por **contorno del documento**: umbral binario sobre la imagen → búsqueda del primer píxel de borde blanco/negro → trazado del contorno 8-conexo (Moore) → sectores angulares desde el centroide para obtener 4 esquinas → validación por área mínima.
- **Limitaciones**: Depende de que el borde del papel sea el contorno más grande y bien definido; no usa los 4 marcadores de esquina de forma explícita; la ordenación de esquinas es geométrica (sectores), no por identidad de marcador. Con iluminación desigual, sombras o fondos ruidosos la detección puede ser inestable.

### ArUco vs ChArUco — Decisión

| Criterio | ArUco | ChArUco |
|----------|--------|---------|
| **Detección en navegador** | Sí: js-aruco2 (JS puro), ARuco-ts (TypeScript). API: `detector.detect(imageData)` → `markers[]` con `id` y `corners`. | Típicamente OpenCV (C++/Python). opencv.js tiene bindings ArUco/ChArUco pero el bundle es pesado y la API en JS menos documentada para ChArUco. |
| **Precisión geométrica** | Buena: 4 esquinas por marcador, IDs únicos permiten ordenar tl, tr, br, bl sin ambigüedad. | Mejor: rejilla de casillas + ArUco permite subpíxel y calibración de cámara. |
| **Generación en PDF** | Factible: el mismo diccionario (p. ej. ARUCO_MIP_36h12) puede generar SVG por ID; se convierte a imagen y se coloca en el PDF en las 4 posiciones. | Más complejo: hay que dibujar tablero ChArUco completo; excede el alcance de “solo mejorar marcadores” sin tocar backend. |
| **Calibración de cámara** | Opcional: se puede añadir después con un tablero de calibración (p. ej. ChArUco o ajedrez) en una utilidad aparte. | Ideal para calibración, pero la calibración queda como fase opcional/futura. |

**Decisión elegida: ArUco (4 marcadores con IDs 0, 1, 2, 3).**

- Motivos: (1) Librería JS disponible (js-aruco2), sin tocar backend. (2) IDs únicos permiten ordenar las 4 esquinas de forma robusta (tl, tr, br, bl). (3) Misma geometría de hoja (área interior, aspecto); solo se sustituye el “dibujo” del marcador. (4) ChArUco se reserva para una fase futura de calibración (opcional) si se usa opencv.js o un servicio backend.

### Calibración de cámara

- **Decisión**: Opcional y no implementada en esta entrega.
- Opciones razonables: (A) Utilidad separada (p. ej. pantalla que muestre un tablero de calibración, el usuario captura N imágenes, se envían a un backend con OpenCV o se procesan con opencv.js para obtener matriz de cámara y distorsión; se guardan en localStorage por dispositivo). (B) No implementar: el flujo sigue funcionando sin calibración; la homografía basada en 4 puntos ArUco ya mejora mucho la estabilidad.
- En este entregable: **solo se documenta** la opción; no se añade código de calibración para no invadir la experiencia principal y mantener el alcance acotado.

### Integración sin romper el flujo robusto actual

- **V1 (actual)**: Hoja con cuadrados negros; detección por contorno (`findSheetCornersAndWarp`); lectura local por burbuja (`readLibelIASheetFromImage`).
- **V2 (nuevo)**: Hoja con 4 fiduciales ArUco en las mismas posiciones; detección por ArUco (`findSheetCornersFiducialAndWarp`); misma lectura por burbuja.
- Estrategia: (1) Añadir variante de hoja **libelia_standard_v2** (generador PDF dibuja ArUco en lugar de cuadrados). (2) Nuevo módulo **sheet-perspective-fiducial.ts** que detecta los 4 marcadores, ordena por ID y aplica la homografía existente. (3) En **RobustLibeliaOMRModal**, si la plantilla tiene `sheetSpec === "libelia_standard_v2"`, usar detección por fiduciales; si falla o no es V2, usar el flujo actual por contorno. (4) No tocar `/api/evaluate`, scoring, persist-evaluation, OCR, análisis pedagógico, etc.

---

## 2. Decisión elegida y por qué

- **ArUco** (4 marcadores, diccionario ARUCO_MIP_36h12, IDs 0–3 en posiciones tl, tr, br, bl).
- **Por qué**: Librería js-aruco2 en el frontend; detección estable con IDs; generación de marcadores vía `Dictionary.generateSVG(id)` para el PDF; misma geometría que la hoja actual; no requiere backend ni OpenCV en servidor. ChArUco queda como mejora futura para calibración.

---

## 3. Archivos nuevos

| Archivo | Descripción |
|---------|-------------|
| `app/lib/sheet-perspective-fiducial.ts` | Detección de 4 ArUco (js-aruco2), ordenación por ID, homografía y warp; exporta `findSheetCornersFiducialAndWarp`. |
| `app/lib/omr-sheet-aruco.ts` | Generación de imágenes de marcadores ArUco (SVG → canvas → data URL) para IDs 0–3, usando el mismo diccionario que el detector. |
| `AUDITORIA_OMR_FIDUCIALES_LIBELIA.md` | Este documento. |

---

## 4. Archivos modificados

| Archivo | Cambio | Riesgo |
|---------|--------|--------|
| `app/lib/omr-sheet-pdf.ts` | Soporte de variante `sheetSpec: "libelia_standard_v2"`: dibujar fiduciales ArUco en lugar de cuadrados (usando imágenes generadas por `omr-sheet-aruco.ts`). Mantener V1 intacto. | Bajo: solo nueva rama por opción de hoja. |
| `app/components/OMRSheetGeneratorModal.tsx` | Opción en UI para “Hoja estándar V2 (fiduciales ArUco)”; al generar, pasar `sheetSpec: "libelia_standard_v2"` al generador de PDF. | Bajo: solo nueva opción y prop. |
| `app/components/RobustLibeliaOMRModal.tsx` | Si la plantilla seleccionada tiene `sheetSpec === "libelia_standard_v2"`, llamar a `findSheetCornersFiducialAndWarp`; si falla o no es V2, usar `findSheetCornersAndWarp`. Añadir estado opcional de debug (fiduciales detectados). | Bajo: rama condicional; flujo V1 sin cambios. |
| `app/lib/omr-template-store.ts` | Permitir `sheetSpec: "libelia_standard_v2"` en plantillas (ya se usa `libelia_standard_v1`). | Bajo: solo valor adicional. |
| `package.json` | Añadir dependencia `js-aruco2`. | Bajo. |

---

## 5. Riesgo por archivo

- **sheet-perspective-fiducial.ts**: Nuevo; no sustituye `sheet-perspective.ts`. Si js-aruco2 falla en algún entorno, el modal puede hacer fallback a contorno.
- **omr-sheet-aruco.ts**: Nuevo; solo se usa al generar PDF V2.
- **omr-sheet-pdf.ts**: Cambio acotado a la rama “v2”; V1 sigue dibujando cuadrados.
- **RobustLibeliaOMRModal.tsx**: Condicional por `sheetSpec`; no se tocan compare, retry-save ni flujos existentes.
- **OMRSheetGeneratorModal.tsx**: Solo nueva opción de tipo de hoja.
- No se modifican: OMR antiguo, RealtimeOMRModal, TemplateOverlayOMRModal, `/api/evaluate`, `/api/evaluate/batch`, scoring, persist-evaluation, OCR, análisis pedagógico, gráficos, diagnóstico, parsers, retry-save.

---

## 6. Código (resumen)

- **sheet-perspective-fiducial.ts**: Crea `AR.Detector` (ARUCO_MIP_36h12), `detect(imageData)`; filtra marcadores con `id` en {0,1,2,3}; ordena por id → [tl, tr, br, bl]; toma por cada marcador la esquina “interior” al contenido (p. ej. corners[2] para id 0, etc.); construye `QuadCorners` y llama a `warpPerspectiveToDataUrl` (reutilizando la lógica de `sheet-perspective.ts`). Exporta `findSheetCornersFiducialAndWarp(dataUrl, templateAspectRatio)`.
- **omr-sheet-aruco.ts**: Carga js-aruco2, crea `AR.Dictionary('ARUCO_MIP_36h12')`, `generateSVG(0..3)`, renderiza cada SVG en un canvas pequeño, devuelve data URL o similar para que el PDF las use en las 4 posiciones.
- **omr-sheet-pdf.ts**: Si `opts.sheetSpec === 'libelia_standard_v2'`, obtener 4 imágenes de marcadores desde `omr-sheet-aruco`, luego `doc.addImage` en las 4 esquinas; si no, `drawMarkers(doc)` actual (cuadrados).
- **RobustLibeliaOMRModal**: Tras subir imagen, si `selectedTemplate?.sheetSpec === 'libelia_standard_v2'`, `findSheetCornersFiducialAndWarp`; en caso de fallo o si no es V2, `findSheetCornersAndWarp`. Resto igual (readLibelIASheetFromImage, compare, revisión, retry-save).

---

## 7. Explicación breve

Se sube el flujo robusto de la hoja LibelIA a un nivel superior: en lugar de cuadrados negros se usan **4 fiduciales ArUco** (diccionario ARUCO_MIP_36h12, IDs 0–3) en las mismas posiciones. La detección pasa a ser por **ArUco** (js-aruco2), con esquinas ordenadas por ID para una homografía estable. Se mantiene la **lectura local por burbuja** y el **contraste con la clave interna**; no se toca backend ni scoring. La **calibración de cámara** queda opcional y documentada para una fase posterior. V1 y V2 coexisten; el usuario puede generar hojas V2 y usar plantillas V2 en el modal robusto.

---

## 8. Checklist manual

- [ ] El sistema actual sigue intacto (OMR antiguo, RealtimeOMRModal, TemplateOverlayOMRModal, APIs, scoring, persistencia, análisis, gráficos, diagnóstico, parsers, retry-save).
- [ ] La hoja LibelIA robusta (V1) sigue funcionando con cuadrados y detección por contorno.
- [ ] Existe la variante de hoja V2 con fiduciales ArUco y se puede generar desde el modal de generación.
- [ ] La detección geométrica con fiduciales (V2) es más estable que con marcadores simples cuando se usa hoja V2.
- [ ] La rectificación con 4 puntos ArUco mejora la alineación para la lectura.
- [ ] La lectura local por burbuja sigue funcionando igual (mismo `readLibelIASheetFromImage`).
- [ ] El contraste contra la clave interna y la revisión mínima siguen funcionando.
- [ ] No se rompe ningún flujo ni componente prohibido.
