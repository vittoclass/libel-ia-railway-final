# Microservicio LEADTOOLS OMR para LibelIA

Endpoint real: **POST /read-omr**. Contrato alineado con LibelIA. Con `LEADTOOLS_MOCK=true` devuelve respuestas válidas para probar end-to-end sin licencia LEADTOOLS.

## Requisitos

- Node.js 18+

## Variables de entorno

| Variable | Descripción | Ejemplo |
|---------|-------------|---------|
| `PORT` | Puerto HTTP | `5000` |
| `LEADTOOLS_MOCK` | Si `true`, responde con datos mock (rotando A/B/C/D) | `true` |

## Instalación y ejecución

```bash
cd services/leadtools-omr
npm install
npm run dev
```

O compilar y ejecutar:

```bash
npm run build
LEADTOOLS_MOCK=true npm start
```

Por defecto escucha en **http://localhost:5000**.

## Contrato

**Request (POST /read-omr):**

```json
{
  "imageBase64": "<base64>",
  "templateId": "omr_123",
  "numQuestions": 40,
  "optionLabels": ["A", "B", "C", "D"]
}
```

**Response 200 (éxito):**

```json
{
  "success": true,
  "results": [
    { "pregunta": 1, "respuesta": "A", "confianza": 0.95 }
  ],
  "omissions": [],
  "doubleMarks": [],
  "metadata": { "engine": "leadtools-mock", "processingTimeMs": 12 }
}
```

**Response error:**

```json
{ "success": false, "error": "mensaje claro" }
```

## Logs

Con `npm run dev` verás:

- `[LEADTOOLS_SERVICE] escuchando en http://localhost:5000 (LEADTOOLS_MOCK=true)`
- `[LEADTOOLS_SERVICE] request recibida`
- `[LEADTOOLS_SERVICE] modo MOCK activo, generando respuestas válidas`
- `[LEADTOOLS_SERVICE] resultados generados` { total, processingTimeMs }

## Integración con motor real

En `src/read-omr.ts`, cuando `LEADTOOLS_MOCK` no está activo, el código decodifica la imagen y está listo para llamar al SDK LEADTOOLS OMR. Reemplace el `return { success: false, error: "..." }` por la llamada al SDK y el mapeo a `results[]`.

## Health check

**GET /health** → `{ "ok": true, "service": "leadtools-omr", "mock": true }`
