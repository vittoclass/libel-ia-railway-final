# Diagnóstico pedagógico avanzado — LibelIA

**Objetivo:** Generar diagnóstico automático, evidencia pedagógica y mapa de calor a partir de los datos ya existentes del análisis pedagógico, sin modificar lógica de cálculo ni flujos actuales.

---

## 1. Archivos nuevos

| Archivo | Descripción |
|---------|-------------|
| `app/lib/pedagogical-diagnosis-text.ts` | Módulo que genera texto de diagnóstico, evidencia y mensaje de triangulación a partir de `by_axis`, `by_skill`, `by_cognitive_level`, `most_failed_questions`. Solo lectura; no modifica análisis ni scoring. |

---

## 2. Archivos modificados

| Archivo | Cambio | Riesgo |
|---------|--------|--------|
| `app/api/courses/[courseId]/pedagogical-summary/route.ts` | Se agrega `question_heat_map`: array derivado de los `analyses` existentes (logro promedio por `item_number`). Se incluye en la respuesta JSON en todos los casos (vacío si no hay datos). | Bajo. Solo añade un campo; no se modifica `analyzeLearningResults` ni `aggregateCourseSummary`. |
| `app/components/CoursePedagogicalSummaryModal.tsx` | Se agregan tres secciones después de los gráficos: (1) **Diagnóstico pedagógico** con párrafos generados por `buildPedagogicalDiagnosis`, (2) **Evidencia pedagógica** con preguntas, eje y habilidad, más mensaje de triangulación si aplica, (3) **Mapa de calor de preguntas** con 🟢/🟡/🔴 por pregunta (≥70% verde, 50–69% amarillo, <50% rojo). Se elimina la función local `buildCourseDiagnosis` no usada. | Bajo. Solo añade UI y consume datos ya devueltos por la API. |

---

## 3. Explicación breve

- **Mapa de calor:** La API ya entrega por evaluación `by_question` (por análisis). En la ruta del resumen se agrega por curso un array `question_heat_map` con `item_number` y `logro_pct` (promedio entre evaluaciones). El modal muestra cada pregunta con un indicador de desempeño según umbrales 70% / 50%.
- **Diagnóstico automático:** Se usa `buildPedagogicalDiagnosis()` con los mismos datos que ya muestra el resumen (by_axis, by_skill, by_cognitive_level, most_failed_questions). Genera párrafos tipo: mayor dificultad en eje X, preguntas con mayor error (números), habilidad asociada, sugerencia de reforzar interpretación y resolución de problemas.
- **Evidencia:** A partir de `most_failed_questions` se arma una lista de “Evidencia de dificultad” con preguntas (y % error), eje y habilidad.
- **Triangulación:** Si varias preguntas con alto error comparten el mismo eje o la misma habilidad, se muestra un mensaje de patrón consistente (ej. “Se observa un patrón consistente de error en la habilidad comprensión, evidenciado en múltiples preguntas del eje Números y Operaciones”).
- **PDF:** El informe PDF se exporta desde el mismo contenedor que ya incluye las nuevas secciones; no se tocó `export-report-pdf.ts`. Al exportar, el PDF incluye diagnóstico, evidencia y mapa de calor.

No se modificó: `/api/evaluate`, scoring, OCR, OMR, `persist-evaluation.ts`, `analyze-learning-results.ts`, gráficos, importación/asociación de pruebas base ni parsers.

---

## 4. Checklist manual

- [ ] El resumen pedagógico del curso sigue funcionando (tablas por eje, habilidad, nivel cognitivo, preguntas con mayor error).
- [ ] El análisis por alumno sigue funcionando (modal de evaluación individual).
- [ ] Aparece la sección **Diagnóstico pedagógico** con párrafos automáticos.
- [ ] Aparece la sección **Evidencia pedagógica** (preguntas, eje, habilidad) cuando hay preguntas con error; si aplica, el mensaje de triangulación.
- [ ] Aparece la sección **Mapa de calor de preguntas** con indicadores 🟢🟡🔴 y porcentaje por pregunta.
- [ ] Los porcentajes del mapa de calor y del diagnóstico coinciden con las tablas y gráficos existentes.
- [ ] Al exportar informe PDF del curso, el PDF incluye diagnóstico, evidencia y mapa de calor.
- [ ] No se rompe la evaluación (subir respuestas, corregir).
- [ ] No se rompe el scoring ni el análisis pedagógico existente.
- [ ] No se rompe nada del sistema actual (cursos, evaluaciones, pruebas base, informe, archivar).

---

## 5. Reglas de color (mapa de calor)

| Logro | Color |
|-------|--------|
| ≥ 70% | 🟢 Verde |
| 50–69% | 🟡 Amarillo |
| < 50% | 🔴 Rojo |
