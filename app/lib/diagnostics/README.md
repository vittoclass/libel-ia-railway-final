# Photo → OMR Diagnostic Flight Recorder (FASE B)

Módulo **diagnóstico aislado e inerte**. No está conectado al pipeline de LibelIA.

## Archivos

- `photo-omr-pipeline-diag.ts` — módulo
- `__tests__/photo-omr-pipeline-diag.test.ts` — pruebas offline
- este `README.md`

## Uso futuro (no activado)

Callers futuros construirán un snapshot ya redactado y llamarán:

```ts
import {
  isPhotoOmrPipelineDiagnosticEnabled,
  buildSafeDiagnosticSnapshot,
  safeDiagnosticEvent,
} from "@/app/lib/diagnostics/photo-omr-pipeline-diag"
```

En FASE B **ningún** archivo funcional importa este módulo.

## Feature flag

Variable: `LIBELIA_PHOTO_OMR_PIPELINE_DIAG`

- Solo el valor exacto `1` habilita emisión
- Ausencia, `""`, `0`, `false`, `true` → OFF
- No asociar a `NODE_ENV`
- En esta fase la flag no tiene efecto en runtime (no hay imports)

## Sink

Una línea por evento:

```text
[PHOTO_OMR_DIAG] {"schemaVersion":1,"event":"...","timestamp":"..."}
```

## Pruebas offline

El repo no incluye runner Jest/Vitest en `package.json`. No se modificó configuración.

Ejecutar con la convención existente `npx tsx`:

```bash
npx tsx app/lib/diagnostics/__tests__/photo-omr-pipeline-diag.test.ts
```

## Rollback

Eliminar únicamente esta carpeta / estos archivos. Como no hay imports desde runtime, el sistema funcional vuelve al estado previo.

No ejecutar rollback automáticamente.
