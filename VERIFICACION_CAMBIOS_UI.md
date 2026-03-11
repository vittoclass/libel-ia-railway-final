# Verificación real de cambios aplicados en UI — LibelIA

## Cómo comprobar que los cambios están activos

1. **Recompilar y recargar:** En la raíz del proyecto ejecuta `npm run dev`. Con el servidor en marcha, en el navegador haz **recarga forzada** (Ctrl+Shift+R en Windows/Linux, Cmd+Shift+R en Mac) para cargar el JS/CSS nuevo.
2. **Pestañas:** Los cambios están en pestañas concretas; comprueba en la pestaña indicada en cada punto.

---

## A. ESTUDIANTES

### Cambio A1: Botón "Análisis pedagógico"
- **Estado:** APLICADO
- **Archivo:** `app/EvaluatorClient.tsx`
- **Ubicación en código:** Líneas 6251 (TableHead), 6264-6330 (Button con icono BookOpen y texto "Análisis pedagógico"), 6325 (texto del botón).
- **Dónde debería verse:** Pestaña **Estudiantes** → tabla "Historial por estudiante" → columna **"Análisis pedagógico"** → botón con icono de libro y texto "Análisis pedagógico" en cada fila de estudiante.
- **Si no se ve:** Comprueba que estás en la pestaña **Estudiantes** (no en Evaluaciones ni Cursos). Si la tabla no tiene esa columna, recarga forzada (Ctrl+Shift+R) o reinicia `npm run dev`.

### Cambio A2: Mensaje "Este estudiante aún no tiene evaluaciones."
- **Estado:** APLICADO
- **Archivo:** `app/EvaluatorClient.tsx`
- **Ubicación en código:** Línea 6284, `title: noEvals ? "Este estudiante aún no tiene evaluaciones." : ...`
- **Dónde debería verse:** Pestaña **Estudiantes** → al hacer clic en "Análisis pedagógico" de un estudiante que **no tiene evaluaciones** → aparece un **toast** (notificación) con el título "Este estudiante aún no tiene evaluaciones."
- **Si no se ve:** Solo aparece cuando el estudiante tiene 0 evaluaciones. Prueba con un estudiante sin evaluaciones o comprueba en la consola del navegador (F12) que el toast se dispara.

### Cambio A3: Apertura del modal de análisis
- **Estado:** APLICADO
- **Archivo:** `app/EvaluatorClient.tsx`
- **Ubicación en código:** Líneas 6297-6299 (`setPedagogicalAnalysisEvalId`, `setPedagogicalAnalysisEvalLabel`), y el modal se controla con `pedagogicalAnalysisEvalId` (líneas 6152-6164).
- **Dónde debería verse:** Pestaña **Estudiantes** → clic en "Análisis pedagógico" de un estudiante **con al menos una evaluación** → se abre el **modal** "Análisis pedagógico de evaluación — [Nombre estudiante] — [Título evaluación]".
- **Si no se ve:** Comprueba que el estudiante tiene evaluaciones (columna "Evaluaciones" > 0). Si tiene evaluaciones y no abre, abre la consola (F12) por si hay errores de JavaScript.

### Cambio A4: Logs o toasts
- **Estado:** APLICADO
- **Archivo:** `app/EvaluatorClient.tsx`
- **Ubicación en código:** Toasts en 6282-6288 (sin evaluaciones), 6312 (abriendo modal), 6316 (error). Logs en dev en 6275-6280, 6300-6307, 6312-6314.
- **Dónde debería verse:** Toasts en la esquina de la pantalla (según tu componente de toast). Logs solo en **consola del navegador** (F12 → Console) con prefijo `[Estudiantes]`.
- **Si no se ve:** Los logs solo salen en desarrollo (`NODE_ENV !== "production"`). Los toasts dependen de que el componente de toast esté montado (por ejemplo en el layout).

---

## B. CURSO

### Cambio B1: Bloque visible de error o fallback
- **Estado:** APLICADO
- **Archivo:** `app/components/CoursePedagogicalSummaryModal.tsx`
- **Ubicación en código:** Líneas 184-188 (error con borde y fondo destructivo), 189-191 (fallback cuando !data).
- **Dónde debería verse:** Al abrir **"Ver resumen pedagógico"** de un curso → si hay **error de red** o **respuesta sin datos**, en el modal aparece un recuadro con borde rojo y el texto del error, o el texto "No se pudo cargar el resumen pedagógico."
- **Si no se ve:** Solo se muestra cuando `error` está seteado (fetch falló) o cuando `!loading && !error && !data` (caso raro). Para forzar error puedes desconectar la red y abrir el resumen.

### Cambio B2: Encabezado con curso / evaluaciones encontradas / con prueba base / analizables
- **Estado:** APLICADO
- **Archivo:** `app/components/CoursePedagogicalSummaryModal.tsx`
- **Ubicación en código:** Líneas 53-76 (`SummaryBlock`), 194 (`<SummaryBlock data={data} />`). El título del modal en 172-174 con "Resumen pedagógico del curso: [nombre]".
- **Dónde debería verse:** Al abrir **"Ver resumen pedagógico"** de un curso y cargar bien la API → **arriba del contenido** del modal, un bloque con: "Resumen del curso", "Curso: ...", "Evaluaciones encontradas: X", "Con prueba base: Y", "Analizables: Z".
- **Si no se ve:** (1) La API debe devolver `evaluation_count_total`, `evaluation_count_with_source_exam`, `evaluation_count_analyzable` (el endpoint `/api/courses/[courseId]/pedagogical-summary` ya los envía). (2) Si la API es antigua o no envía esos campos, "Con prueba base" y "Analizables" no se renderizan (hasNewFields queda false). Reinicia el servidor para asegurar que usas la última API.

---

## C. EVALUACIONES

### Cambio C1: Columna Estudiante con nombre o "Sin nombre de estudiante"
- **Estado:** APLICADO
- **Archivo:** `app/EvaluatorClient.tsx`
- **Ubicación en código:** Línea 4766: `ev.first_student_name && String(ev.first_student_name).trim() ? ev.first_student_name : "Sin nombre de estudiante"`. Columna en la tabla de la pestaña **Evaluaciones** (línea 4748 TableHead "Estudiante").
- **Dónde debería verse:** Pestaña **Evaluaciones** (la primera, lista principal de evaluaciones) → tabla con columnas Fecha, Curso, Asignatura, Título, Nota, Estado, Estudiantes, **Estudiante**, Acciones → en **Estudiante** debe verse el nombre del alumno o, si falta, el texto **"Sin nombre de estudiante"**.
- **Si no se ve:** (1) Tienes que estar en la pestaña **Evaluaciones**, no dentro de Cursos (dentro de Cursos la tabla no tiene columna Estudiante). (2) "Sin nombre de estudiante" solo aparece cuando esa evaluación no tiene `first_student_name`; si todas tienen nombre, verás nombres. (3) La API `/api/evaluations/list` debe devolver `first_student_name` (ya lo hace en línea 146 del route).

### Cambio C2: Label del modal priorizando nombre del estudiante
- **Estado:** APLICADO
- **Archivo:** `app/EvaluatorClient.tsx` (quién pasa el label) y `app/components/PedagogicalAnalysisModal.tsx` (quién lo muestra).
- **Ubicación en código:** EvaluatorClient líneas 4837-4842 (fila) y 5848-5855 (detalle): `first_student_name ? (title ? \`${first_student_name} — ${title}\` : first_student_name) : (title || null)`. PedagogicalAnalysisModal línea 157: `Análisis pedagógico de evaluación{evaluationLabel ? ` — ${evaluationLabel}` : ""}`.
- **Dónde debería verse:** Al abrir **"Análisis pedagógico"** desde la fila de Evaluaciones o desde el detalle de una evaluación → el **título del modal** debe ser "Análisis pedagógico de evaluación — [Nombre del estudiante]" o "Análisis pedagógico de evaluación — [Nombre] — [Título]".
- **Si no se ve:** Solo si `evaluationLabel` llega al modal; se envía al hacer clic en "Análisis pedagógico" en la tabla de Evaluaciones o en el panel de detalle. Recarga la página y abre de nuevo el análisis desde ahí.

---

## Resumen de verificación

| # | Cambio | Aplicado | Archivo | Dónde verlo |
|---|--------|----------|---------|--------------|
| A1 | Botón Análisis pedagógico (Estudiantes) | Sí | EvaluatorClient.tsx ~6251, 6325 | Pestaña Estudiantes → columna "Análisis pedagógico" |
| A2 | Toast "Este estudiante aún no tiene evaluaciones." | Sí | EvaluatorClient.tsx 6284 | Estudiantes → clic Análisis en estudiante sin evaluaciones |
| A3 | Apertura modal desde Estudiantes | Sí | EvaluatorClient.tsx 6297-6299, 6152-6164 | Estudiantes → clic Análisis en estudiante con evaluaciones |
| A4 | Toasts y logs | Sí | EvaluatorClient.tsx 6282-6316 | Toasts en UI; logs en F12 Console |
| B1 | Error/fallback en modal Curso | Sí | CoursePedagogicalSummaryModal.tsx 184-191 | Modal resumen curso cuando hay error o sin data |
| B2 | Encabezado Curso (conteos) | Sí | CoursePedagogicalSummaryModal.tsx 53-76, 194 | Modal resumen curso → primer bloque con Curso, Evaluaciones, Con prueba base, Analizables |
| C1 | Columna Estudiante / "Sin nombre de estudiante" | Sí | EvaluatorClient.tsx 4766, 4748 | Pestaña Evaluaciones → columna "Estudiante" |
| C2 | Título del modal con nombre | Sí | EvaluatorClient.tsx 4837-4842, 5848-5855; PedagogicalAnalysisModal.tsx 157 | Modal "Análisis pedagógico" abierto desde Evaluaciones o detalle |

---

## Acciones si no ves los cambios

1. **Reiniciar dev y recargar:** `npm run dev` y en el navegador **Ctrl+Shift+R** (o Cmd+Shift+R).
2. **Comprobar pestaña:** Estudiante/columna Estudiante y botón Análisis en **Estudiantes**; columna Estudiante y label del modal en **Evaluaciones**; bloque de resumen en el **modal de Curso** (Ver resumen pedagógico).
3. **Datos:** "Sin nombre de estudiante" solo cuando no hay nombre; toast "Este estudiante aún no tiene evaluaciones." solo cuando el estudiante tiene 0 evaluaciones.
4. **Consola:** F12 → Console por si hay errores que impidan renderizar; en dev verás logs `[Estudiantes]` y `[Evaluaciones]`.

No se ha modificado evaluate, scoring, Ver informe, Archivar, parsers ni importación.
