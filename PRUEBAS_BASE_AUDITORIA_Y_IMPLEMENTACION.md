# Pruebas base – Auditoría (Etapa 1) e implementación (Etapa 2)

## ETAPA 1: AUDITORÍA SIN CODIFICAR

### 1. Resumen del enfoque más seguro

- **Nueva pestaña "Pruebas base"** dentro del mismo `Tabs` de `EvaluatorClient`, sin cambiar rutas ni layout. El contenido es un **componente nuevo** en archivo separado (`SourceExamsSection.tsx`) que se encarga de listar y crear pruebas base.
- **APIs nuevas** exclusivas para source_exams: `GET/POST /api/source-exams` y `POST /api/evaluations/[id]/associate-source-exam`. No se toca `/api/evaluate` ni listado de evaluaciones.
- **Asociación manual**: en el diálogo de detalle de evaluación (pestaña Evaluaciones) se añade un botón "Asociar a prueba base" que abre un modal para elegir una prueba base de la lista y guardar el vínculo con las utilidades ya existentes (`source-exam-db`).
- **Sin parser PDF/Word** en esta fase: creación de prueba base solo con formulario manual (título, asignatura, curso, tipo de instrumento). El parser queda para una fase posterior.
- Si la nueva capa falla (API o componente), el resto de la app sigue igual: la pestaña solo afecta a quien la abre; las demás pestañas y flujos no dependen de ella.

### 2. Lista de archivos nuevos a crear

| Archivo | Propósito |
|--------|-----------|
| `app/api/source-exams/route.ts` | GET: listar source_exams del teacher_id del perfil. POST: crear source_exam con teacher_id del perfil (campos: title, subject, course_label, exam_type, pedagogy_mode). |
| `app/api/evaluations/[id]/associate-source-exam/route.ts` | POST: body `{ source_exam_id }`. Comprueba que la evaluación pertenezca al usuario; llama `associateEvaluationToSourceExam`. |
| `app/components/SourceExamsSection.tsx` | Componente cliente: lista de pruebas base (GET /api/source-exams), formulario para crear una nueva (POST), sin parser. Títulos claros "Pruebas base" / "Banco de pruebas base". |

### 3. Lista de archivos existentes a modificar

| Archivo | Cambio |
|--------|--------|
| `app/EvaluatorClient.tsx` | (1) Añadir un `TabsTrigger` "Pruebas base" y un `TabsContent` que renderice `<SourceExamsSection />`. (2) En el `Dialog` de detalle de evaluación (cuando `evaluacionesDetailId` está abierto), añadir botón "Asociar a prueba base" y modal interno para elegir prueba base y llamar a la API de asociación. |

### 4. Riesgo por archivo modificado

| Archivo | Riesgo | Motivo |
|--------|--------|--------|
| `app/EvaluatorClient.tsx` | **Bajo** | Cambios solo aditivos: una pestaña más (trigger + content) y un botón + estado + modal en el bloque del detalle. No se altera lógica de evaluación, guardado, informe ni archivar. El modal de asociación es autocontenido (fetch lista, select, submit). |

### 5. Justificación de por qué no se rompe la app

- **Pestaña nueva**: no cambia el valor por defecto de `activeTab` ni el comportamiento de las pestañas ya existentes. Si `SourceExamsSection` falla, solo falla esa pestaña.
- **APIs nuevas**: no modifican rutas existentes ni contratos de `/api/evaluate`, `/api/evaluations/list`, etc. Usan el mismo patrón de autenticación (getOrCreateProfile / teacher_id).
- **Asociación**: solo escribe en `evaluation_source_exams` y en `evaluations.source_exam_id`. No modifica `evaluation_items`, scoring, ni informe. El botón está en el detalle y no interfiere con "Ver informe" ni "Archivar".
- **Documentos separados**: en la UI se usa siempre el término "Pruebas base" (instrumento en blanco). El formulario de creación no pide respuestas del estudiante ni datos de evaluación respondida.

### 6. Cómo se evita mezclar documentos y entidades

- **source_exam** = prueba base / instrumento en blanco. Solo se crea y lista en la sección "Pruebas base"; el formulario pide título, asignatura, curso, tipo de examen.
- **evaluation** = evaluación respondida. La asociación es un vínculo explícito "esta evaluación usa esta prueba base"; no se copian datos de uno al otro ni se mezcla con answer_key o rúbrica.
- En el modal "Asociar a prueba base" el texto dirá explícitamente "Asociar esta evaluación a una prueba base" y se listarán solo títulos de pruebas base, sin confundir con evaluaciones.

### 7. Qué parte queda manual en esta fase

- **Creación de prueba base**: 100 % manual mediante formulario (título, asignatura, curso/nivel, tipo de instrumento, modo pedagógico). Sin subida de archivo ni parser.
- **Asociación evaluación ↔ prueba base**: manual; el usuario elige una evaluación y luego elige una prueba base de la lista. No hay auto-match ni inferencia.

---

## ETAPA 2: IMPLEMENTACIÓN

(Ver código en los archivos listados arriba.)

### Archivos creados

- **`app/api/source-exams/route.ts`**: GET lista por teacher_id; POST crea con title, subject, course_label, exam_type, pedagogy_mode.
- **`app/api/evaluations/[id]/associate-source-exam/route.ts`**: POST body `{ source_exam_id }`; comprueba propiedad de la evaluación; llama `associateEvaluationToSourceExam`.
- **`app/components/SourceExamsSection.tsx`**: Listado de pruebas base, formulario de creación (sin parser), textos "Pruebas base" / "Banco de pruebas base".

### Archivos modificados

- **`app/EvaluatorClient.tsx`**:
  - Import de `BookOpen` y `SourceExamsSection`.
  - Estado: `associateSourceExamOpen`, `sourceExamsForAssociate`, `associateSourceExamLoading`, `selectedSourceExamIdForAssociate`.
  - Nuevo `TabsTrigger` "Pruebas base" y `TabsContent` con `<SourceExamsSection />`.
  - En el diálogo de detalle de evaluación: botón "Asociar a prueba base" que abre modal para elegir prueba base y POST a `/api/evaluations/:id/associate-source-exam`.
  - Nuevo `Dialog` "Asociar a prueba base" con Select de pruebas base y botón Asociar.

---

## Checklist de pruebas manuales posterior a los cambios

- [ ] **Evaluación normal**: Subir/corregir una prueba y guardar; sigue funcionando igual.
- [ ] **Guardado de evaluaciones**: La evaluación se guarda y aparece en la lista.
- [ ] **Ver informe**: Desde Evaluaciones, abrir una evaluación y ver informe; sin cambios.
- [ ] **Archivar**: Archivar una evaluación desde la tabla; sin cambios.
- [ ] **Cursos**: Abrir Cursos; listado y diagnóstico sin cambios.
- [ ] **Estudiantes**: Abrir Estudiantes; listado y perfil sin cambios.
- [ ] **Nueva sección Pruebas base**: Abrir la pestaña "Pruebas base"; carga sin errores; se ve listado (vacío o con datos) y formulario de creación.
- [ ] **Crear prueba base**: Completar formulario (título, asignatura, etc.) y enviar; aparece en la lista; no afecta evaluaciones existentes.
- [ ] **Asociar evaluación a prueba base**: Con una evaluación abierta en el detalle, pulsar "Asociar a prueba base", elegir una prueba base y guardar; la asociación se guarda; la nota y el resumen de la evaluación no cambian.
- [ ] **Sin mezcla de documentos**: Verificar que en ningún momento se pida "respuestas del estudiante" al crear prueba base ni "prueba respondida" en la lista de pruebas base.
- [ ] **Fallback**: Si las APIs de source-exams fallan (ej. tabla no existe), la pestaña Pruebas base puede mostrar error pero el resto de la app (Evaluaciones, Cursos, Estudiantes, Evaluador) sigue funcionando igual.
