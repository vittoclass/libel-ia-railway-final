// components/OMRPreviewModal.tsx
'use client';
import { useState, useEffect } from 'react';
import { X, RotateCcw, AlertCircle, Eye, ZoomIn } from 'lucide-react'; 
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface OMRItem {
  id: string;
  value: string;
  confidence: number;
  bbox?: [number, number, number, number];
}

export default function OMRPreviewModal({
  imageUrl,
  onClose,
  onConfirm,
  onRescan,
}: {
  imageUrl: string;
  onClose: () => void;
  onConfirm: (data: { items: OMRItem[] }) => void;
  onRescan: () => void;
}) {
  const [items, setItems] = useState<OMRItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomedItem, setZoomedItem] = useState<OMRItem | null>(null);

  useEffect(() => {
    // Si no hay URL, no intentar extraer y mostrar un error
    if (!imageUrl) {
        setLoading(false);
        setError("Error: No se ha proporcionado una imagen válida (dataUrl está vacío).");
        return;
    }

    const extract = async () => {
      setLoading(true);
      setError(null);
      setItems([]);
      try {
        const res = await fetch('/api/omr/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileUrl: imageUrl,
            mimeType: 'image/jpeg',
            expectedItemCount: 40,
            useAzureFallback: true,
          }),
        });
        const data = await res.json();
        
        if (data.success && Array.isArray(data.items)) {
          setItems(data.items);
        } else {
          setError(data.error || 'Error en extracción. La IA no pudo detectar las marcas.');
        }
      } catch (e) {
        setError('Error de red o servidor al intentar la extracción OMR.');
      } finally {
        setLoading(false);
      }
    };
    extract();
  }, [imageUrl]);

  const lowConfidenceItems = items.filter((i) => i.confidence < 0.92);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-5xl h-[90vh] flex flex-col bg-white">
        <div className="flex justify-between items-center p-4 border-b">
          <div className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold">🔍 Previsualización de Respuestas (OMR)</h2>
            {loading ? (
                <div className="text-sm text-gray-500">Cargando...</div>
            ) : error ? (
                <div className="flex items-center gap-1 text-red-600 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    <span>Error en la detección</span>
                </div>
            ) : lowConfidenceItems.length > 0 ? (
              <div className="flex items-center gap-1 text-yellow-600 text-sm bg-yellow-50 p-1 rounded">
                <AlertCircle className="h-4 w-4" />
                <span>{lowConfidenceItems.length} ítems requieren revisión</span>
              </div>
            ) : (
                <div className="flex items-center gap-1 text-green-600 text-sm">
                    <span>✅ Detección exitosa ({items.length} ítems)</span>
                </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 grid grid-cols-3 gap-4 p-4 overflow-hidden">
          {/* Vista de imagen con overlay */}
          <div className="col-span-2 relative overflow-hidden rounded border bg-gray-50">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
                  <span className="text-sm">Extrayendo respuestas...</span>
                </div>
              </div>
            ) : error ? (
              <div className="text-red-600 p-4 flex flex-col items-center">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p className='text-center'>{error}</p>
                <Button size='sm' variant='outline' className='mt-3' onClick={onClose}>Cerrar</Button>
              </div>
            ) : (
              <>
                <img
                  src={imageUrl}
                  alt="Hoja de respuestas"
                  className="w-full h-full object-contain max-h-[70vh]"
                />
                {items.map((item, i) => (
                  item.bbox && (
                    <div
                      key={`bbox-${i}`}
                      className={`absolute border-2 rounded pointer-events-none transition-all ${
                        item.confidence < 0.92
                          ? 'border-red-500 bg-red-200 bg-opacity-30'
                          : 'border-green-500 bg-green-200 bg-opacity-20'
                      }`}
                      style={{
                        // ❌ CORRECCIÓN CRÍTICA: La biblioteca de OMR típicamente devuelve coordenadas normalizadas (0-1000 o 0-1)
                        // Para mostrar el bounding box correctamente sobre la imagen, necesitamos una lógica de escalado
                        // Aquí asumimos que las coordenadas son píxeles o porcentajes *escalables*.
                        // Si las coordenadas son píxeles, esto funciona si el modal maneja el tamaño. 
                        // Mantenemos el código original de BBox si se asume que la capa superior es del tamaño de la imagen.
                        left: `${item.bbox[0]}px`,
                        top: `${item.bbox[1]}px`,
                        width: `${item.bbox[2]}px`,
                        height: `${item.bbox[3]}px`,
                      }}
                      onMouseEnter={() => setZoomedItem(item)}
                      onMouseLeave={() => setZoomedItem(null)}
                    >
                      <span className="absolute -top-6 left-0 bg-black text-white text-xs px-1 rounded">
                        {item.id}: {item.value}
                      </span>
                    </div>
                  )
                ))}
                {/* Lógica de Zoom, mantenida sin cambios */}
                {zoomedItem && zoomedItem.bbox && (
                  <div className="absolute top-4 right-4 w-32 h-32 border-2 border-blue-500 rounded shadow-lg overflow-hidden bg-white">
                    <img
                      src={imageUrl}
                      alt="Zoom"
                      className="w-full h-full object-cover"
                      style={{
                        clipPath: `inset(
                          ${zoomedItem.bbox[1] - 20}px
                          ${100 - (zoomedItem.bbox[0] + zoomedItem.bbox[2] + 20)}px
                          ${100 - (zoomedItem.bbox[1] + zoomedItem.bbox[3] + 20)}px
                          ${zoomedItem.bbox[0] - 20}px
                        )`,
                        transform: `scale(2)`,
                        transformOrigin: `${zoomedItem.bbox[0] + zoomedItem.bbox[2] / 2}px ${
                          zoomedItem.bbox[1] + zoomedItem.bbox[3] / 2
                        }px`,
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Panel derecho */}
          <div className="flex flex-col gap-3 overflow-hidden">
            <div className="text-sm font-semibold">
              Resultados ({items.length} ítems)
            </div>
            <div className="flex-1 overflow-y-auto border rounded p-2 bg-gray-50">
                {/* 🎯 CORRECCIÓN CRÍTICA: Asegurar que se itere sobre el estado 'items' */}
              {!loading && !error && items.length === 0 && (
                <div className='text-gray-500 text-center p-4'>
                    <AlertCircle className="h-6 w-6 mx-auto mb-2" />
                    No se detectaron respuestas OMR.
                </div>
              )}
              {items.map((item, i) => (
                <div
                  key={i}
                  className={`p-2 rounded flex justify-between items-center text-sm ${
                    item.confidence < 0.92
                      ? 'bg-red-50 border border-red-200'
                      : 'hover:bg-gray-100' // Cambio para mejor UX
                  }`}
                >
                  <span className="font-mono">
                    <span className="text-blue-600 font-bold">{item.id}</span>: {item.value || '?'}
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      item.confidence < 0.92 ? 'text-red-600' : 'text-green-600'
                    }`}
                  >
                    {Math.round(item.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onRescan}
                disabled={loading}
              >
                <RotateCcw className="h-3 w-3 mr-1" /> Re-escanear
              </Button>
              <Button
                size="sm"
                onClick={() => onConfirm({ items })}
                disabled={loading || error !== null || items.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                ✅ Confirmar y evaluar
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}