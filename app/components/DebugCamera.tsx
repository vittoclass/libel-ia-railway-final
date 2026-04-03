// components/DebugCamera.tsx
'use client';
/* eslint-disable @next/next/no-img-element -- Data URL desde canvas (debug). */
import { useState, useRef, useEffect } from 'react';

export default function DebugCamera({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<string | null>(null);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      if (videoRef.current) videoRef.current.srcObject = stream;
    });
  }, []);

  const capture = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 480;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    setImg(c.toDataURL());
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', padding: 20, borderRadius: 8, maxWidth: '90vw' }}>
        <button onClick={onClose} style={{ float: 'right' }}>✕</button>
        <h3>Debug: ¿Funciona la previsualización?</h3>
        <div style={{ width: '100%', height: 300, background: '#000', marginBottom: 10, position: 'relative' }}>
          {img ? (
            <img src={img} alt="debug" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
        {!img ? (
          <button onClick={capture} style={{ background: 'blue', color: 'white', padding: '10px 20px', borderRadius: 4 }}>
            📸 Capturar
          </button>
        ) : (
          <div>
            <p>✅ ¡Previsualización activa! Si ves esta imagen, el problema es solo en tu SmartCameraModal.</p>
            <button onClick={() => setImg(null)} style={{ background: 'gray', color: 'white', padding: '5px 10px', margin: '5px' }}>
              Retomar
            </button>
            <button onClick={onClose} style={{ background: 'green', color: 'white', padding: '5px 10px', margin: '5px' }}>
              ✅ Confirmar (cierra)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}