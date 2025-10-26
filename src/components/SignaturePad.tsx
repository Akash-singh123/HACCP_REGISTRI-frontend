import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Trash2, Save } from 'lucide-react';

interface SignaturePadProps {
  onSignatureChange: (signature: string) => void;
  initialSignature?: string;
  width?: number;
  height?: number;
}

export const SignaturePad: React.FC<SignaturePadProps> = ({
  onSignatureChange,
  initialSignature,
  width = 400,
  height = 200
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Configura canvas
    canvas.width = width;
    canvas.height = height;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Carica eventuale firma iniziale
    if (initialSignature) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        setHasSignature(true);
      };
      img.src = initialSignature;
    }
  }, [width, height, initialSignature]);

  // --- Funzioni di disegno comuni ---
  const getCoords = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const touch = e.touches[0];
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    } else {
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
  };

  const startDrawing = (e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e, canvas);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = (e?: MouseEvent | TouchEvent) => {
    e?.preventDefault();
    setIsDrawing(false);
  };

  // --- Gestione eventi touch/mouse ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Aggiungi listener manuali per il touch
    canvas.addEventListener('touchstart', startDrawing);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', stopDrawing);

    // Pulizia listener quando il componente viene smontato
    return () => {
      canvas.removeEventListener('touchstart', startDrawing);
      canvas.removeEventListener('touchmove', draw);
      canvas.removeEventListener('touchend', stopDrawing);
    };
  }, [isDrawing]);

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    setHasSignature(false);
    onSignatureChange('');
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataURL = canvas.toDataURL('image/png');
    onSignatureChange(dataURL);
  };

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="text-sm font-medium">Firma OSA</div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-2">
          <canvas
            ref={canvasRef}
            className="border border-gray-200 rounded cursor-crosshair touch-none"
            onMouseDown={startDrawing as any}
            onMouseMove={draw as any}
            onMouseUp={stopDrawing as any}
            onMouseLeave={stopDrawing as any}
          />
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearSignature}
            disabled={!hasSignature}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Cancella
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={saveSignature}
            disabled={!hasSignature}
          >
            <Save className="w-4 h-4 mr-2" />
            Salva Firma
          </Button>
        </div>
      </div>
    </Card>
  );
};
