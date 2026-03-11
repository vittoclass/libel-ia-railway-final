# Gestión de ítems de prueba base – Auditoría e implementación

## ETAPA 1: AUDITORÍA (sin codificar)

### 1. Dónde encaja sin romper la app

- La sección **"Pruebas base"** vive en **SourceExamsSection.tsx**, dentro de la pestaña del mismo nombre en EvaluatorClient. No se tocan otras pestañas ni el flujo de evaluación.
- Encaje: **dentro de SourceExamsSection**, al elegir una prueba base del listado (clic en fila o botón "Ver ítems") se muestra un **detalle** con subsección "Ítems de la prueba": listado, agregar uno, editar uno, opcional eliminar. Todo sigue siendo **prueba base** (source_exam / source_exam_items); no se mezcla con evaluation ni con answer_key.
- EvaluatorClient solo renderiza `<SourceExamsSection />`; no hace falta tocarlo si el nuevo comportamiento queda encapsulado en ese componente y en APIs propias de source-exams.

### 2. Archivos nuevos a crear

| Archivo | Propósito |
|--------|-----------|
| **app/api/source-exams/[id]/items/[itemId]/route.ts** | PATCH: actualizar un ítem (item_number, item_text, axis_id, skill_id, competence, difficulty). DELETE: borrar un ítem. Comprobar que el ítem pertenezca a una source_exam del teacher_id del perfil. |
| **app/components/SourceExamItemsPanel.tsx** | Componente que recibe sourceExamId y sourceExamTitle; lista ítems (GET), formulario para agregar uno (POST), edición por fila o modal (PATCH), botón eliminar con confirmación (DELETE). Solo trabaja con source_exam_items; no referencia evaluation_items ni respuestas del estudiante. |

### 3. Archivos existentes a modificar

| Archivo | Cambio |
|--------|--------|
| **app/api/source-exams/[id]/items/route.ts** | Añadir **GET**: listar ítems de esa source_exam (misma comprobación de permiso por teacher_id). Mantener POST tal cual. |
| **app/components/SourceExamsSection.tsx** | Añadir estado `selectedSourceExamId` y `selectedSourceExamTitle`. En la tabla de pruebas base, añadir botón "Ver ítems" (o fila clicable) que asigne ese estado. Cuando hay selección, mostrar `<SourceExamItemsPanel sourceExamId={...} sourceExamTitle={...} onBack={() => setSelectedSourceExamId(null)} />` y opción "Volver" al listado. No eliminar ni reescribir el listado ni el formulario de creación de prueba base. |

### 4. Riesgo por archivo

| Archivo | Riesgo | Motivo |
|--------|--------|--------|
| **app/api/source-exams/[id]/items/route.ts** | Bajo | Solo se añade un GET; POST existente no se toca. Misma auth que ya usa la ruta. |
| **app/api/source-exams/[id]/items/[itemId]/route.ts** | Bajo | Rutas nuevas; solo afectan a source_exam_items; comprobación de propiedad vía source_exam.teacher_id. |
| **app/components/SourceExamItemsPanel.tsx** | Bajo | Componente nuevo; no toca evaluación ni informe. |
| **app/components/SourceExamsSection.tsx** | Bajo | Cambios aditivos: estado de selección + bloque condicional "detalle con ítems" y botón Volver. Flujo actual de listar/crear pruebas base se mantiene. |

### 5. Cómo se evita mezclar ítems de prueba base con evaluación del estudiante

- **Nomenclatura y contexto:** Siempre "Pruebas base" → "Ítems de la prueba base". En la UI no se usa "respuestas del estudiante" ni "evaluación" en esta pantalla.
- **APIs:** Solo se usan tablas `source_exams` y `source_exam_items`. No se lee ni escribe en `evaluation_items`, `evaluations` (salvo la asociación ya existente), ni en answer_key.
- **Componentes:** SourceExamItemsPanel solo llama a `/api/source-exams/[id]/items` y `/api/source-exam-items/[itemId]`; no tiene referencia a evaluación ni a informe.

### 6. Qué se deja manual para reducir riesgo

- Carga y edición de ítems **100 % manual**: sin parser PDF/Word, sin importación masiva, sin autoasociación. El usuario agrega/edita ítems uno a uno en el panel.
- axis_id y skill_id: se permiten como UUID opcionales o, si se prefiere menor dependencia de catálogos, se puede usar un campo de texto libre (p. ej. "eje" / "habilidad") en una fase posterior; en esta fase se mantienen los campos actuales de la BD (axis_id, skill_id, competence, difficulty) para no tocar migraciones.

---

## ETAPA 2: IMPLEMENTACIÓN

### Archivos nuevos

- **app/api/source-exams/[id]/items/[itemId]/route.ts**  
  PATCH: actualiza un ítem (item_number, item_text, axis_id, skill_id, competence, difficulty). DELETE: elimina un ítem. Comprueba que el ítem pertenezca a una source_exam del teacher_id del perfil.

- **app/components/SourceExamItemsPanel.tsx**  
  Panel que recibe sourceExamId y sourceExamTitle; lista ítems (GET), formulario para agregar uno (POST), edición en modal (PATCH), eliminación con confirmación (DELETE). Solo trabaja con source_exam_items.

### Archivos modificados

- **app/api/source-exams/[id]/items/route.ts**  
  Añadido GET para listar ítems de la prueba base. Refactorizada comprobación de permiso en `checkSourceExamAccess` y reutilizada en GET y POST.

- **app/components/SourceExamsSection.tsx**  
  Añadidos estado `selectedSourceExamId` y `selectedSourceExamTitle`, botón "Ver ítems" por fila, y vista condicional: si hay selección se muestra `SourceExamItemsPanel`, si no se muestran el formulario de creación y el listado de pruebas base (con columna "Acciones" y "Ver ítems").

### Por qué no rompe la app

- Solo se añaden rutas y un componente nuevo; no se toca evaluación, informe ni scoring.
- La sección "Pruebas base" sigue mostrando listado y creación de pruebas base; el detalle de ítems es una vista adicional al pulsar "Ver ítems".
- source_exam_items se gestiona solo en este flujo; no se mezcla con evaluation_items ni con respuestas del estudiante.

---

## Checklist de pruebas manuales

- [ ] Evaluación normal: corregir y guardar una prueba; sin cambios.
- [ ] Guardado de evaluaciones; listado y detalle; sin cambios.
- [ ] Ver informe y Archivar; sin cambios.
- [ ] Cursos y Estudiantes; sin cambios.
- [ ] Pestaña Pruebas base: listado y creación de prueba base; sin cambios.
- [ ] Abrir una prueba base (Ver ítems): se muestra el panel de ítems.
- [ ] Listar ítems: vacío o con datos según BD.
- [ ] Crear un ítem: se guarda y aparece en la lista.
- [ ] Editar un ítem: se actualiza y se ve el cambio.
- [ ] Eliminar un ítem: desaparece de la lista; no afecta a evaluaciones ya existentes.
- [ ] Asociación evaluación ↔ prueba base sigue funcionando; nota y resumen no cambian.
