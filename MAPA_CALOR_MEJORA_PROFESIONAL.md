# Mejora profesional del mapa de calor de preguntas — LibelIA

**Objetivo:** Hacer que el mapa de calor del resumen pedagógico del curso se vea ordenado, profesional y legible, sin romper nada del sistema actual.

---

## 1. Auditoría breve

**Estado anterior:**
- El mapa de calor se renderizaba dentro de `CoursePedagogicalSummaryModal.tsx`.
- Usaba `data.question_heat_map` (ordenado por `item_number`) y `getHeatMapLevel()` para verde/amarillo/rojo.
- Se mostraba como lista lineal: `<div className="flex flex-wrap gap-x-4 gap-y-2">` con cada ítem como texto "Pregunta N 🟢 (logro%)".
- Leyenda en una sola línea de texto.
- Sin tooltip; no se mostraban eje ni habilidad aunque la API ya los envía en `question_heat_map`.
- Con muchas preguntas la lista resultaba larga y poco clara.

**Archivos involucrados:**
- Solo presentación en el modal; la API y el cálculo de `question_heat_map` no se tocaron.

---

## 2. Archivos nuevos

| Archivo | Descripción |
|---------|-------------|
| `app/components/QuestionHeatMap.tsx` | Componente que recibe `items` (mismo formato que `question_heat_map`) y renderiza: leyenda con cuadros de color, grilla responsiva (5/8/10 columnas), celdas compactas con número y color según logro, tooltip con pregunta, logro %, eje y habilidad. Usa `getHeatMapLevel` de `pedagogical-diagnosis-text` (misma lógica). |

---

## 3. Archivos modificados

| Archivo | Cambio | Riesgo |
|---------|--------|--------|
| `app/components/CoursePedagogicalSummaryModal.tsx` | Se importa `QuestionHeatMap` y se reemplaza el bloque anterior del mapa de calor (lista con emojis) por `<QuestionHeatMap items={heatMap} />`. Se deja de importar `getHeatMapLevel` en el modal (queda solo en el nuevo componente). | Bajo. Misma fuente de datos (`heatMap`); solo cambia la presentación. |

---

## 4. Riesgo por archivo

- **QuestionHeatMap.tsx:** Solo lectura de props y misma lógica de color ya existente. No llama APIs ni modifica estado global.
- **CoursePedagogicalSummaryModal.tsx:** Sustitución de un bloque de JSX por un componente; `reportRef` sigue envolviendo todo el contenido, por lo que la exportación PDF incluye el nuevo mapa.

---

## 5. Diseño implementado

- **Grilla:** CSS Grid con `grid-cols-5 sm:grid-cols-8 md:grid-cols-10`, `gap-1.5`. Hasta 10 preguntas por fila en pantallas grandes.
- **Celdas:** Cada pregunta es una celda cuadrada (`aspect-square`), con número centrado, fondo según nivel (verde/amarillo/rojo) y borde. Colores: emerald-600, amber-500, red-600.
- **Leyenda:** Tres ítems con cuadro de color + texto "Verde = ≥70%", "Amarillo = 50–69%", "Rojo = <50%".
- **Tooltip:** Al pasar el mouse (o tocar en táctil), se muestra: Pregunta N, Logro N%, Eje, Habilidad. Radix Tooltip con `TooltipProvider` local al componente.
- **PDF:** El contenido del mapa está dentro del mismo `reportRef` que se exporta con html2canvas/jsPDF; la grilla y los colores se capturan en la exportación.

---

## 6. Explicación breve

Se extrajo la visualización del mapa de calor a un componente dedicado que recibe los mismos datos que antes. La grilla ordenada y las celdas compactas mejoran la lectura cuando hay muchas preguntas. La leyenda y el tooltip dan contexto sin saturar la vista. No se modificó la lógica de cálculo ni el backend.

---

## 7. Checklist manual

- [ ] El resumen pedagógico del curso sigue funcionando.
- [ ] El mapa de calor se ve ordenado y profesional (grilla, celdas, leyenda).
- [ ] Sigue usando los mismos datos (`question_heat_map`).
- [ ] Con muchas preguntas, el mapa se mantiene legible (filas de 5/8/10 según ancho).
- [ ] La leyenda aparece clara (Verde ≥70%, Amarillo 50–69%, Rojo <50%).
- [ ] Al pasar el mouse (o tocar) la celda, el tooltip muestra pregunta, logro %, eje y habilidad.
- [ ] La exportación a PDF del informe del curso sigue funcionando y el mapa se ve razonablemente bien en el PDF.
- [ ] No se rompe nada del sistema actual (evaluación, scoring, análisis, otros modales).

---

## 8. Reglas de color (sin cambios)

| Logro | Color |
|-------|--------|
| ≥ 70% | Verde |
| 50–69% | Amarillo |
| < 50% | Rojo |
