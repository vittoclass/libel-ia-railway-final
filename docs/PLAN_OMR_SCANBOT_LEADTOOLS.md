# Plan: Scanbot + LEADTOOLS OMR (reemplazo de Aspose)

## Objetivo

Reemplazar Aspose como lector OMR principal por:
1. **Scanbot Web Document Scanner SDK** (frontend) — captura guiada, edge detection, recorte/normalización.
2. **LEADTOOLS OMR** en microservicio .NET (backend) — POST /read-omr.
3. **LibelIA** mantiene compare, scoring, persistencia e informes sin cambios.

---

## Arquitectura mínima

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js / React)                                                  │
│  ┌──────────────────────┐   ┌─────────────────────────────────────────────┐ │
│  │ Scanbot SDK          │   │ Flujo robusto OMR (RobustLibeliaOMRModal)    │ │
│  │ - Captura guiada     │──▶│ - Sube imagen (o usa la de Scanbot)         │ │
│  │ - Edge detection     │   │ - POST /api/omr/read-leadtools (si provider) │ │
│  │ - Recorte/normaliz.  │   │ - compare → review → retry-save             │ │
│  └──────────────────────┘   └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LIBELIA BACKEND (Next.js API)                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ /api/omr/read-leadtools  (nuevo)                                    │   │
│  │ - Lee OMR_PROVIDER=leadtools                                         │   │
│  │ - Proxy a microservicio LEADTOOLS_OMR_URL/read-omr                    │   │
│  │ - Devuelve GridReadResult[]                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ /api/omr/compare, /api/evaluations/retry-save (intactos)             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MICROSERVICIO OMR (.NET) — LEADTOOLS                                       │
│  POST /read-omr                                                             │
│  - Recibe: imagen (base64) + templateId + numQuestions + optionLabels       │
│  - Devuelve: results[], omissions[], doubleMarks[], confidence              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Contrato JSON entre LibelIA y microservicio LEADTOOLS

### Request (LibelIA → microservicio)

**POST** `{LEADTOOLS_OMR_URL}/read-omr`  
**Content-Type:** `application/json`

```json
{
  "imageBase64": "string (base64 sin prefijo data:image/...)",
  "templateId": "string (identificador plantilla OMR LibelIA)",
  "numQuestions": 40,
  "optionLabels": ["A", "B", "C", "D"]
}
```

| Campo           | Tipo     | Obligatorio | Descripción                                      |
|-----------------|----------|-------------|--------------------------------------------------|
| imageBase64     | string   | Sí          | Imagen de la hoja en base64 (JPEG/PNG).         |
| templateId      | string   | Sí          | Id de plantilla para que LEADTOOLS cargue su .omr/template. |
| numQuestions    | number   | Sí          | Número de preguntas (1–200).                     |
| optionLabels    | string[] | Sí          | Opciones válidas, ej. ["A","B","C","D"].         |

### Response (microservicio → LibelIA)

**200 OK** — éxito

```json
{
  "success": true,
  "results": [
    { "pregunta": 1, "respuesta": "A", "confianza": 0.95 },
    { "pregunta": 2, "respuesta": "B", "confianza": 0.92 },
    { "pregunta": 3, "respuesta": "", "confianza": 0 }
  ],
  "omissions": [3, 7],
  "doubleMarks": [],
  "metadata": {
    "engine": "leadtools",
    "processingTimeMs": 120
  }
}
```

| Campo        | Tipo     | Descripción |
|-------------|----------|-------------|
| success     | boolean  | Siempre true en 200. |
| results     | array    | Uno por pregunta. `pregunta` (number), `respuesta` (string: "A"–"E" o "" o "DOBLE_MARCA"), `confianza` (0–1). |
| omissions   | number[] | Preguntas sin marca detectada. |
| doubleMarks | number[] | Preguntas con doble marca. |
| metadata    | object   | Opcional: engine, processingTimeMs. |

**4xx/5xx** — error

```json
{
  "success": false,
  "error": "Descripción del error"
}
```

LibelIA espera al menos `results` con forma `{ pregunta: number, respuesta: string, confianza: number }[]` para alimentar `/api/omr/compare` sin cambios.

---

## Archivos a crear / modificar

### Tarea 1 — Scanbot (frontend)

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `app/components/ScanbotDocumentScanner.tsx` | Crear | Componente que inicializa Scanbot SDK, captura documento, recorta/normaliza y devuelve imagen (data URL o base64). |
| `app/lib/scanbot-config.ts` | Crear | Configuración/license key (env NEXT_PUBLIC_SCANBOT_*). |
| `app/components/RobustLibeliaOMRModal.tsx` | Modificar | Opción “Capturar con Scanbot” que abre ScanbotDocumentScanner y usa la imagen resultante para el flujo actual (upload → read-omr/aspose/libelia → compare). |
| `package.json` | Modificar | Añadir dependencia `scanbot-web-sdk` (o el paquete oficial Scanbot Web). |

Referencia: [Scanbot Web SDK – Document Scanner](https://docs.scanbot.io/document-scanner-sdk/web/).

### Tarea 2 — Microservicio LEADTOOLS (.NET)

| Archivo/Proyecto | Acción | Descripción |
|------------------|--------|-------------|
| `services/leadtools-omr/` | Crear | Solución .NET (minimal API o ASP.NET Core). |
| `services/leadtools-omr/Program.cs` | Crear | POST /read-omr que recibe el JSON de request, llama a LEADTOOLS OMR, devuelve el JSON de response. |
| `services/leadtools-omr/Models/ReadOmrRequest.cs` | Crear | DTO request (ImageBase64, TemplateId, NumQuestions, OptionLabels). |
| `services/leadtools-omr/Models/ReadOmrResponse.cs` | Crear | DTO response (Success, Results, Omissions, DoubleMarks, Metadata). |
| `services/leadtools-omr/OmrService.cs` | Crear | Lógica LEADTOOLS: cargar imagen, cargar template por templateId, reconocer, mapear a results/omissions/doubleMarks. |
| `services/leadtools-omr/Dockerfile` | Crear | Opcional: imagen para desplegar el microservicio. |

No se toca ningún otro servicio de LibelIA.

### Tarea 3 — LibelIA adapter (leadtools)

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `app/api/omr/read-leadtools/route.ts` | Crear | POST: lee OMR_PROVIDER y LEADTOOLS_OMR_URL; reenvía body al microservicio; normaliza respuesta a `{ success, results }` (GridReadResult[]). |
| `app/lib/omr-provider.ts` | Crear | `getOMRProvider(): "aspose" \| "leadtools" \| "libelia"` desde env; `readOMR(image, template, options)` que según provider llama a Aspose, read-leadtools o LibelIA. |
| `app/lib/omr-leadtools-reader.ts` | Crear | `readOMRWithLeadTools(imageDataUrl, numQuestions, optionLabels, templateId)` → llama a `/api/omr/read-leadtools`, devuelve `Promise<GridReadResult[]>`. |
| `app/components/RobustLibeliaOMRModal.tsx` | Modificar | Si `omr-provider === "leadtools"`, usar `readOMRWithLeadTools` en lugar de Aspose; si falla, fallback a lector LibelIA. Mantener compare/scoring/persistencia intactos. |
| `.env.example` | Modificar | Añadir `OMR_PROVIDER=leadtools`, `LEADTOOLS_OMR_URL=http://localhost:5000`. |

No se toca: scoring, `/api/omr/compare`, OCR general, informes, análisis pedagógico, RealtimeOMRModal, TemplateOverlayOMRModal (salvo si se quiere ofrecer Scanbot ahí más adelante).

---

## Plan de implementación rápida

### Fase 1 — Contrato y proxy (LibelIA)

1. Crear `app/lib/omr-contract.ts` con tipos TypeScript del request/response del microservicio.
2. Crear `app/api/omr/read-leadtools/route.ts`: proxy a `LEADTOOLS_OMR_URL/read-omr`, mismo body, mapear respuesta a `{ success, results }`.
3. Crear `app/lib/omr-leadtools-reader.ts`: cliente que llama a `/api/omr/read-leadtools` y devuelve `GridReadResult[]`.
4. Crear `app/lib/omr-provider.ts`: leer `OMR_PROVIDER`; exponer función que elige Aspose vs LeadTools vs LibelIA.
5. En `RobustLibeliaOMRModal.tsx`: si provider === "leadtools", llamar a `readOMRWithLeadTools`; si falla, fallback a `readLibelIASheetFromImage`. No tocar compare ni retry-save.

**Criterio de éxito:** Con microservicio mock (devuelve JSON de ejemplo), el flujo robusto muestra resultados y compare funciona.

### Fase 2 — Microservicio LEADTOOLS (.NET)

1. Crear proyecto ASP.NET Core en `services/leadtools-omr/`.
2. Implementar POST /read-omr con DTOs del contrato.
3. Integrar LEADTOOLS OMR SDK: cargar imagen desde base64, cargar template por templateId (o fichero .omr asociado), ejecutar reconocimiento, rellenar results/omissions/doubleMarks.
4. Probar con Postman/curl desde LibelIA (env LEADTOOLS_OMR_URL apuntando al microservicio).

**Criterio de éxito:** Envío de imagen + templateId desde LibelIA devuelve results compatibles con compare.

### Fase 3 — Scanbot (captura)

1. Añadir dependencia Scanbot Web SDK.
2. Crear `ScanbotDocumentScanner.tsx` con captura guiada, edge detection y entrega de imagen recortada/normalizada.
3. En `RobustLibeliaOMRModal.tsx` añadir botón/opción “Capturar con Scanbot” que abre el scanner y pasa la imagen al flujo actual (sin cambiar compare/scoring).

**Criterio de éxito:** Usuario captura hoja con Scanbot y la misma imagen se envía a read-leadtools → compare → guardado.

---

## Variables de entorno

| Variable | Uso | Ejemplo |
|----------|-----|---------|
| `OMR_PROVIDER` | LibelIA: "aspose" \| "leadtools" \| "libelia" | `leadtools` |
| `LEADTOOLS_OMR_URL` | Base URL del microservicio OMR | `http://localhost:5000` |
| `NEXT_PUBLIC_SCANBOT_LICENSE` | Scanbot SDK (frontend) | (según documentación Scanbot) |

---

## Resumen

- **Arquitectura:** Frontend (Scanbot opcional + flujo robusto) → LibelIA API (read-leadtools proxy) → Microservicio LEADTOOLS (/read-omr). Compare/scoring/persistencia solo en LibelIA, sin tocar.
- **Contrato:** Request con imageBase64, templateId, numQuestions, optionLabels. Response con success, results (pregunta, respuesta, confianza), omissions, doubleMarks.
- **Archivos clave:** `read-leadtools/route.ts`, `omr-leadtools-reader.ts`, `omr-provider.ts`, cambios mínimos en `RobustLibeliaOMRModal.tsx`; microservicio en `services/leadtools-omr/`; componente `ScanbotDocumentScanner.tsx` + config.
- **Implementación:** Fase 1 contrato + proxy + provider en LibelIA; Fase 2 microservicio .NET; Fase 3 Scanbot en frontend.
