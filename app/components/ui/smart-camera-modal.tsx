"use client";
/* eslint-disable @next/next/no-img-element -- Frames de cámara / captura (data URL). */

import { useEffect, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMediaPipe } from "@/hooks/use-media-pipe";
import { Loader2, CheckCircle, CameraOff, AlertTriangle, X } from "lucide-react";

interface SmartCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (files: File[]) => void; // 👈 Cambiado a File[]
}

export const SmartCameraModal = ({ isOpen, onClose, onCapture }: SmartCameraModalProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [capturedImages, setCapturedImages] = useState<string[]>([]); // 👈 Ahora es un array
  const [feedbackMessage, setFeedbackMessage] = useState("Buscando documento...");
  const [isCaptureEnabled, setIsCaptureEnabled] = useState(false);
  const detectionBoxRef = useRef<HTMLDivElement>(null);
  const animationFrameId = useRef<number>();

  const { isLoading, error, detectObjects } = useMediaPipe();

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      } catch (err) {
        console.error("Error al acceder a la cámara:", err);
        setFeedbackMessage("❌ Permiso de cámara denegado.");
      }
    } else {
      setFeedbackMessage("❌ La cámara no es compatible con este navegador.");
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      startCamera();
      setCapturedImages([]); // 👈 Reiniciar al abrir
    }
    return () => stopCamera();
  }, [isOpen, startCamera, stopCamera]);

  const detectionLoop = useCallback(() => {
    if (isOpen && !isLoading && !error && videoRef.current && detectionBoxRef.current && capturedImages.length === 0) {
      const detected = detectObjects(videoRef.current);
      if (detected.length > 0 && detected.some(d => d.label === 'book')) {
        const doc = detected[0];
        const { x, y, width, height } = doc.boundingBox;
        const video = videoRef.current;
        const box = detectionBoxRef.current;

        box.style.display = 'block';
        box.style.left = `${(x / video.videoWidth) * 100}%`;
        box.style.top = `${(y / video.videoHeight) * 100}%`;
        box.style.width = `${(width / video.videoWidth) * 100}%`;
        box.style.height = `${(height / video.videoHeight) * 100}%`;

        setFeedbackMessage("✅ Documento detectado. ¡Mantén la cámara estable!");
        setIsCaptureEnabled(true);
      } else {
        if (detectionBoxRef.current) detectionBoxRef.current.style.display = 'none';
        setFeedbackMessage("Apunte al documento...");
        setIsCaptureEnabled(false);
      }
      animationFrameId.current = requestAnimationFrame(detectionLoop);
    }
  }, [detectObjects, capturedImages.length, isOpen, isLoading, error]);

  useEffect(() => {
    if (isOpen && !isLoading && !error) {
      detectionLoop();
    }
    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [isOpen, isLoading, error, detectionLoop]);

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageDataUrl = canvas.toDataURL('image/jpeg');
      setCapturedImages(prev => [...prev, imageDataUrl]); // 👈 Agregar a la lista
      // La cámara sigue activa para tomar más fotos
    }
  };

  const handleAccept = () => {
    if (capturedImages.length > 0 && canvasRef.current) {
      const files: File[] = [];
      capturedImages.forEach((dataUrl, index) => {
        const byteString = atob(dataUrl.split(',')[1]);
        const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: mimeString });
        files.push(new File([blob], `captura-${Date.now()}-${index}.jpg`, { type: 'image/jpeg' }));
      });
      onCapture(files); // 👈 Devolver todas las imágenes
      handleClose();
    }
  };

  const handleRetake = (index: number) => {
    setCapturedImages(prev => prev.filter((_, i) => i !== index));
    if (capturedImages.length === 1) {
      // Si era la última, reactivar la cámara
      startCamera();
    }
  };

  const handleClose = () => {
    setCapturedImages([]);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Cámara Inteligente</DialogTitle>
        </DialogHeader>

        <div className="relative bg-black rounded-lg aspect-video">
          {capturedImages.length > 0 ? (
            <div className="w-full h-full flex overflow-x-auto p-2 gap-2">
              {capturedImages.map((img, index) => (
                <div key={index} className="relative flex-shrink-0">
                  <img src={img} alt={`Captura ${index + 1}`} className="rounded-lg h-full object-contain" />
                  <button
                    onClick={() => handleRetake(index)}
                    className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1"
                    aria-label="Eliminar foto"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain rounded-lg" />
              <canvas ref={canvasRef} className="hidden" />
              <div
                ref={detectionBoxRef}
                className="absolute border-4 border-green-400 rounded-lg transition-all duration-200 pointer-events-none"
                style={{ display: 'none' }}
              />
            </>
          )}

          {isLoading && (
            <div className="absolute inset-0 bg-black bg-opacity-70 flex flex-col items-center justify-center rounded-lg">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
              <p className="mt-2 text-white">Cargando IA de la cámara...</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 bg-black bg-opacity-70 flex flex-col items-center justify-center rounded-lg">
              <CameraOff className="w-12 h-12 text-red-400 mb-2" />
              <p className="text-red-400 text-center max-w-xs">{error}</p>
            </div>
          )}

          {!capturedImages.length && !isLoading && !error && (
            <div
              className={`absolute bottom-4 left-4 p-2 rounded-lg text-white text-sm flex items-center gap-2 transition-colors ${
                isCaptureEnabled ? 'bg-green-600' : 'bg-black bg-opacity-50'
              }`}
            >
              {isCaptureEnabled ? <CheckCircle className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{feedbackMessage}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          {capturedImages.length > 0 ? (
            <>
              <Button onClick={() => startCamera()} variant="outline">
                Tomar otra foto
              </Button>
              <Button onClick={handleAccept}>Aceptar y usar fotos ({capturedImages.length})</Button>
            </>
          ) : (
            <Button onClick={handleCapture} disabled={isLoading || !!error || !isCaptureEnabled} size="lg">
              Tomar Foto
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};