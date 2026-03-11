# Prueba end-to-end: LibelIA + LEADTOOLS OMR

Flujo real sin tocar compare, scoring ni persistencia.

## 1. Levantar el microservicio

```bash
cd services/leadtools-omr
npm install
LEADTOOLS_MOCK=true npm run dev
```

Debe aparecer:

```
[LEADTOOLS_SERVICE] escuchando en http://localhost:5000 (LEADTOOLS_MOCK=true)
```

## 2. Configurar LibelIA

En la raíz del proyecto LibelIA, crear o editar `.env`:

```
OMR_PROVIDER=leadtools
LEADTOOLS_OMR_URL=http://localhost:5000
```

## 3. Levantar LibelIA

```bash
npm run dev
```

## 4. Prueba en el navegador

1. Abrir el flujo de corrección OMR por archivo (modal robusto).
2. Elegir tipo de prueba → Seleccionar una plantilla OMR (o cargar clave).
3. En "Sube la hoja del estudiante", subir una imagen de hoja OMR (o usar "Capturar con scanner mejorado" y cerrar para usar carga manual).
4. El sistema debe:
   - Mostrar toast "Leyendo con LEADTOOLS".
   - Llamar al microservicio; el microservicio (con MOCK) devuelve resultados válidos.
   - Pasar a compare y mostrar "Lectura realizada con motor OMR LEADTOOLS" y la tabla de resultados.

## Logs que debes ver

**Terminal del microservicio:**

- `[LEADTOOLS_SERVICE] request recibida`
- `[LEADTOOLS_SERVICE] modo MOCK activo, generando respuestas válidas`
- `[LEADTOOLS_SERVICE] resultados generados` { total: 20 (o el numQuestions), processingTimeMs }

**Terminal de LibelIA (backend):**

- `[LEADTOOLS_PROXY] Request recibida`
- `[LEADTOOLS_PROXY] Reenviando a microservicio` { url, templateId, numQuestions }
- `[LEADTOOLS_PROXY] Respuesta microservicio` { status: 200, ok: true, bodyResumen, parsedAs: "json" }

**Consola del navegador (F12, desarrollo):**

- `[RobustOMR] usando LEADTOOLS`
- `[LEADTOOLS_READER] iniciando lectura` { numQuestions, optionLabels, templateId }
- `[LEADTOOLS_READER] respuesta recibida` { success: true, resultsLength: 20 }

## Si el microservicio no está levantado

- LibelIA mostrará toast "LEADTOOLS no configurado" o "LEADTOOLS falló, se usó LibelIA" y usará el lector LibelIA como respaldo. Compare y guardado siguen funcionando.

## Qué quedó funcionando hoy

- Microservicio con POST /read-omr y modo mock.
- Proxy en LibelIA y reader LEADTOOLS.
- Provider `leadtools` activo con `OMR_PROVIDER=leadtools`.
- Flujo en el modal: LEADTOOLS → compare → resultado; fallback a LibelIA si falla.
- Componente base Scanbot (mensaje y botón "Usar carga manual"); opción "Capturar con scanner mejorado" en el modal.

## Qué requiere licencia/configuración externa

- **LEADTOOLS OMR real:** sustituir en `services/leadtools-omr/src/read-omr.ts` el bloque "motor real no configurado" por la llamada al SDK LEADTOOLS.
- **Scanbot:** configurar `NEXT_PUBLIC_SCANBOT_LICENSE` e implementar en `ScanbotDocumentScanner.tsx` la captura real y la llamada a `onImageCaptured(dataUrl)`.
