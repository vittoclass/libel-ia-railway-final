# Pulido profesional del flujo OMR en tiempo real — Auditoría y mejoras

**Proyecto:** LibelIA  
**Objetivo:** Dejar el flujo nuevo de OMR en tiempo real útil, claro y robusto, sin tocar el sistema actual.

---

## 1. Auditoría real del flujo nuevo (FASE 1)

### 1.1 Pasos actuales

| Paso | Qué hace hoy | Estado |
|------|----------------|--------|
| **key** | Carga clave: manual (grid por pregunta) o subir imagen → answer-key. Botones "Clave manual" / "Subir plantilla resuelta" con mismo peso visual. | Funcional; poco claro cuál es recomendable. |
| **camera** | Abre cámara, video a pantalla completa sin marco. Texto: "Alinea la hoja... y captura cuando se vea nítida." Botón "Capturar". | Sin overlay ni zona de captura visible; guía débil. |
| **capture** | Al pulsar Capturar: se hace toDataURL, se para la cámara y **se envía de inmediato** a closed-answer y compare. No hay previsualización. | Sin confirmación previa; no hay "Repetir captura" antes de procesar. |
| **result** | Muestra texto: "Se detectaron X correctas, Y incorrectas, Z dudosas", cuadros verde/rojo/ámbar, nota. Formulario estudiante/curso/título/asignatura. Botones "Volver a capturar", "Revisar dudosas" o "Guardar evaluación". | Falta tabla por pregunta (detectada, correcta, estado). Dudosas no destacadas en lista. |
| **review** | Lista de preguntas en requierenRevision: "Pregunta N · Detectado: X · Correcta: Y" y botones A/B/C/D + "Sin respuesta". Botones "Volver" y "Corrección lista para guardar". | UX suficiente pero "respuesta correcta" podría ser más prominente. |
| **done** | Mensaje de éxito y "Cerrar". | Correcto. |

### 1.2 Qué está bien

- Ambas fuentes de clave (manual e imagen) funcionan.
- Integración con closed-answer, compare y retry-save sin tocar backend.
- Revisión solo de preguntas dudosas.
- Cálculo de nota y guardado coherentes con el resto del sistema.

### 1.3 Qué es débil o poco claro

- **Clave:** No se prioriza la opción más fiable (manual); no hay mensaje tipo "Carga una clave correcta antes de iniciar la cámara."
- **Cámara:** No hay overlay ni marco de encuadre; el profesor no ve una “zona” clara donde alinear.
- **Captura:** No hay previsualización; al pulsar Capturar se procesa al instante. Si la foto sale mal, ya se gastó la llamada.
- **Resultado:** No hay tabla por pregunta (número, detectada, correcta, estado); las dudosas no se ven en contexto completo.
- **Antes de guardar:** No hay resumen final explícito (correctas, incorrectas, dudosas corregidas, puntaje).
- **Mensajes:** Algunos son genéricos; faltan frases claras y profesionales en cada paso.

### 1.4 Dónde falta guía visual

- Paso clave: texto de contexto y recomendación (manual primero).
- Paso cámara: marco visible y mensaje fijo "Alinea la hoja dentro del recuadro."
- Paso resultado: tabla con estado por pregunta y dudosas resaltadas.

### 1.5 Dónde el profesor puede confundirse

- No saber si debe usar clave manual o subir imagen.
- No ver bien “dónde” encuadrar la hoja en cámara.
- Creer que al pulsar Capturar puede revisar la foto antes de procesar.
- En revisión, no tener muy claro cuál es la “respuesta correcta” frente a “lo detectado”.

### 1.6 Clave manual vs plantilla por imagen

- **Manual:** Más fiable (sin IA ni calidad de foto). Ideal cuando la pauta está en papel o en la cabeza del profesor.
- **Imagen:** Cómoda si ya tiene una foto de la pauta marcada; depende de answer-key (Mistral) y de la calidad de la imagen.

**Decisión:** Priorizar **clave manual** como opción principal y recomendada. Plantilla por imagen como alternativa secundaria, con etiqueta tipo "Alternativa: subir foto de la pauta".

### 1.7 Revisión de dudosas

- La revisión es suficiente en lógica (solo requierenRevision, confirmar/cambiar/blanco).
- Mejora de UX: mostrar en cada fila de forma muy clara "Respuesta correcta: X" y "Detectado: Y", y botones para elegir la final.

---

## 2. Decisiones de implementación

| Tema | Decisión |
|------|----------|
| Plantilla principal | Clave manual primero, con texto "Recomendado". Subir plantilla resuelta segundo, "Alternativa". |
| Cámara | Overlay estático: marco con esquinas y mensaje "Alinea la hoja dentro del recuadro." Sin detección automática de hoja en V1. |
| Captura | Añadir paso de previsualización: tras Capturar se muestra la foto con "¿Usar esta foto?" y botones "Usar" (procesar) y "Repetir captura". No captura automática. |
| Resultado | Tabla con columnas: Nº pregunta, Respuesta detectada, Respuesta correcta, Estado (Correcta / Incorrecta / Dudosa). Filas dudosas con fondo destacado. Resumen numérico arriba. |
| Antes de guardar | En result y en review: bloque "Resumen final" (correctas, incorrectas, dudosas, puntaje) y botón "Guardar corrección". |
| Revisión | Misma lógica; texto más claro: "Respuesta correcta: X", "Lo detectado: Y", botones para elegir. |
| Mensajes | Unificar con los textos profesionales indicados en FASE 8. |

---

## 3. Archivos modificados

| Archivo | Cambio | Riesgo |
|---------|--------|--------|
| `app/components/RealtimeOMRModal.tsx` | Pulido de UX: orden y textos de clave, overlay en cámara, previsualización antes de procesar, tabla de resultados, resumen final, revisión más clara, mensajes unificados. Sin cambios de APIs ni persistencia. | Bajo. Solo UI y flujo dentro del mismo modal. |

No se añaden archivos nuevos; no se toca EvaluatorClient ni ningún endpoint.

---

## 4. Checklist manual

- [ ] El OMR actual sigue funcionando igual.
- [ ] El flujo nuevo de OMR en tiempo real sigue existiendo.
- [ ] La clave correcta puede cargarse de forma clara (manual recomendada, imagen alternativa).
- [ ] La cámara muestra marco y mensaje "Alinea la hoja dentro del recuadro."
- [ ] Tras capturar se muestra previsualización con "Usar" y "Repetir captura".
- [ ] El resultado muestra correctas / incorrectas / dudosas y tabla por pregunta.
- [ ] El profesor corrige solo lo mínimo (dudosas) con UX clara.
- [ ] Antes de guardar se ve resumen final y botón "Guardar corrección".
- [ ] El resultado se guarda y entra al flujo normal de evaluación.
- [ ] No se rompe nada del sistema actual.

---

## 5. Resumen de cambios (código)

En `RealtimeOMRModal.tsx`: clave con manual recomendado primero; overlay en cámara; paso preview antes de procesar; tabla por pregunta y resumen final; revisión con "Respuesta correcta" / "Lo detectado"; mensajes unificados. Guardado por retry-save sin cambios de backend.
