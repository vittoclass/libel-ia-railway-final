// useEvaluator.ts
'use client';

import { useState, useCallback } from 'react';

// Tipo para la plantilla de respuestas del profesor
export interface AnswerKeyItem {
  pregunta: number;
  respuestaCorrecta: string;
  confianza: number;
  metodo: "auto" | "manual" | "mistral" | "sharp";
}

export interface AnswerKeyData {
  respuestas: AnswerKeyItem[];
  totalPreguntas: number;
  preguntasDudosas: number[];
  imagenPlantilla?: string;
  templateId?: string;
}

// 1. Parsea la pauta del profesor
function parsePauta(pautaStr: string) {
  const lines = pautaStr.split('\n').map(l => l.trim()).filter(Boolean);
  let sm: string[] = [];
  let vf: string[] = [];

  for (const line of lines) {
    if (line.startsWith('SM:')) {
      sm = line.replace('SM:', '').split(',').map(s => s.trim().toUpperCase());
    } else if (line.startsWith('VF:')) {
      vf = line.replace('VF:', '').split(',').map(s => s.trim().toUpperCase());
    }
  }
  return { sm, vf };
}

// 2. Corrige comparando con la pauta
function corregirObjetivas(
  pauta: { sm: string[]; vf: string[] },
  respuestas: { sm: string[]; vf: string[] }
) {
  const smCorregido = pauta.sm.map((correcta, i) => ({
    respuesta: respuestas.sm[i] || '',
    correcta,
    esCorrecta: (respuestas.sm[i] || '').trim().toUpperCase() === correcta
  }));

  const vfCorregido = pauta.vf.map((correcta, i) => ({
    respuesta: respuestas.vf[i] || '',
    correcta,
    esCorrecta: (respuestas.vf[i] || '').trim().toUpperCase() === correcta
  }));

  return {
    sm: smCorregido,
    vf: vfCorregido,
    smCorrectas: smCorregido.filter(r => r.esCorrecta).length,
    vfCorrectas: vfCorregido.filter(r => r.esCorrecta).length
  };
}

/** =========================
 *  OMR: memoria momentánea
 *  ========================= */
const OMR_SESSION_KEY = 'libelia_omr_session_v1';

function loadOmrSession() {
  try {
    return JSON.parse(sessionStorage.getItem(OMR_SESSION_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveOmrSession(obj: any) {
  try {
    sessionStorage.setItem(OMR_SESSION_KEY, JSON.stringify(obj));
  } catch {
    // si storage está bloqueado, no pasa nada
  }
}

/** Detecta URLs/imagenes en el payload sin asumir un nombre único */
function getPayloadFileUrls(payload: any): string[] | null {
  const candidates = [
    payload?.fileUrls,
    payload?.filesUrls,
    payload?.imageUrls,
    payload?.imagenesUrls,
    payload?.imagenes,
    payload?.images
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0 && typeof c[0] === 'string') return c;
  }
  return null;
}

export const useEvaluator = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [answerKey, setAnswerKey] = useState<AnswerKeyData | null>(null);

  // Funcion para guardar la plantilla del profesor (memorizada por el sistema)
  const saveAnswerKey = useCallback((data: AnswerKeyData) => {
    setAnswerKey(data);
    try {
      sessionStorage.setItem('libelia_answer_key_v1', JSON.stringify(data));
      // Persistir también en localStorage para que sobreviva al cierre del navegador
      localStorage.setItem('libelia_answer_key_v1', JSON.stringify(data));
    } catch {
      // Si storage esta bloqueado, no pasa nada
    }
  }, []);

  // Funcion para cargar la plantilla guardada (prioridad: estado > session > localStorage)
  const loadAnswerKey = useCallback((): AnswerKeyData | null => {
    if (answerKey) return answerKey;
    try {
      let stored = sessionStorage.getItem('libelia_answer_key_v1');
      if (!stored) stored = localStorage.getItem('libelia_answer_key_v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        setAnswerKey(parsed);
        return parsed;
      }
    } catch {
      // Si falla, retornamos null
    }
    return null;
  }, [answerKey]);

  // Funcion para limpiar la plantilla
  const clearAnswerKey = useCallback(() => {
    setAnswerKey(null);
    try {
      sessionStorage.removeItem('libelia_answer_key_v1');
      localStorage.removeItem('libelia_answer_key_v1');
    } catch {
      // Si falla, no pasa nada
    }
  }, []);

  // Funcion para convertir la plantilla a formato de pauta texto
  const answerKeyToPauta = useCallback((key: AnswerKeyData): string => {
    // Genera formato compatible: "SM1:A; SM2:B; SM3:C; ..."
    // Usamos prefijo SM para seleccion multiple
    return key.respuestas
      .filter(r => r.respuestaCorrecta && r.respuestaCorrecta.trim() !== "")
      .map(r => `SM${r.pregunta}:${r.respuestaCorrecta}`)
      .join('; ');
  }, []);

  const evaluate = useCallback(async (payload: any): Promise<any> => {
    setIsLoading(true);
    try {
      // ✅ No mutar el payload original
      const payloadFinal: any = { ...payload };

      // Plantilla del profesor: se inyecta SOLO como CLAVE de corrección (respuestas correctas).
      // NUNCA se usa como respuestas del estudiante: la extracción del estudiante viene de sus propias imágenes.
      const currentAnswerKey = loadAnswerKey();
      if (currentAnswerKey && currentAnswerKey.respuestas.length > 0) {
        payloadFinal.answerKeyFromTemplate = currentAnswerKey;
        payloadFinal.pautaPlantilla = answerKeyToPauta(currentAnswerKey);
        if (currentAnswerKey.imagenPlantilla) {
          payloadFinal.templateImageUrl = currentAnswerKey.imagenPlantilla;
        }
        if (currentAnswerKey.templateId) {
          payloadFinal.templateId = currentAnswerKey.templateId;
        }
      }

      /** ======================================
       *  BLOQUE NUEVO (OPCIONAL): OMR Pro
       *  ======================================
       *  - Si /api/omr NO existe o falla: NO rompe nada.
       *  - Si existe y devuelve respuestasAlternativas: se inyecta y tu backend la usará.
       */
      const fileUrls = getPayloadFileUrls(payloadFinal);

      if (fileUrls && fileUrls.length > 0) {
        const omrSession = loadOmrSession();
        const templateId = payloadFinal.templateId || omrSession.templateId || 'auto';
        const captureMode = payloadFinal.captureMode || 'X'; // cruces

        try {
          const omrResp = await fetch('/api/omr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileUrls,
              templateId,
              captureMode,
              sessionCalibration: omrSession.calibration || null
            }),
          });

          // fetch no lanza error por 404, por eso verificamos ok:
          if (omrResp.ok) {
            const omrData = await omrResp.json();

            // Si el OMR trae alternativas, las adjuntamos
            if (omrData?.success && omrData?.respuestasAlternativas) {
              payloadFinal.respuestasAlternativas = omrData.respuestasAlternativas;

              // memoria momentánea (solo si viene algo)
              if (omrData?.templateId || omrData?.calibration) {
                saveOmrSession({
                  templateId: omrData.templateId || templateId,
                  calibration: omrData.calibration || omrSession.calibration || null,
                  updatedAt: Date.now(),
                });
              }
            }
          }
        } catch (e) {
          // IMPORTANTÍSIMO: si el OMR falla, seguimos igual con evaluate
          console.warn('[OMR] No disponible/falló. Continuando evaluación normal.', e);
        }
      }

      // Llama a tu API para procesar imágenes y extraer texto (tu flujo actual)
      const response = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFinal),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error en la evaluación.');
      }

      // Si hay pauta y respuestas extraídas, corrige autom��ticamente (tu lógica actual)
      if (payloadFinal.pauta && data.respuestasExtraidas) {
        const pauta = parsePauta(payloadFinal.pauta);
        const correccion = corregirObjetivas(pauta, data.respuestasExtraidas);

        data.retroalimentacion = {
          ...data.retroalimentacion,
          correccion_objetiva: correccion
        };
      }

      return data;
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, []);

// Nueva funcion: Comparar respuestas del estudiante con la plantilla del profesor
  const compareWithAnswerKey = useCallback(async (studentAnswers: { pregunta: string | number; respuesta: string; confianza: number }[]) => {
    const currentKey = loadAnswerKey();
    if (!currentKey || currentKey.respuestas.length === 0) {
      return { success: false, error: "No hay plantilla del profesor cargada" };
    }

    try {
      const response = await fetch('/api/omr/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answerKey: currentKey.respuestas,
          studentAnswers,
          exigencia: 0.6 // 60% para nota 4.0
        }),
      });

      const data = await response.json();
      return data;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, [loadAnswerKey]);

  return { 
    evaluate, 
    isLoading,
    // Funciones para manejar la plantilla del profesor
    answerKey,
    saveAnswerKey,
    loadAnswerKey,
    clearAnswerKey,
    answerKeyToPauta,
    // Nueva funcion de comparacion
    compareWithAnswerKey,
  };
};
