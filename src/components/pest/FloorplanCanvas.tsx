// src/components/pest/FloorplanCanvas.tsx
// Planimetria interattiva in SVG puro (nessuna dipendenza esterna).
// Mostra l'immagine della pianta e i marcatori delle postazioni: forma per
// tipologia, colore per stato. Consente di posizionare (clic), spostare
// (trascina) e aprire la scheda (clic sul marcatore), con zoom.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PestFloorplan, PestStation, PestStationType } from '@/lib/api';
import { categoryMeta, statusMeta } from './pestMeta';
import { Button } from '@/components/ui/button';
import { Maximize2, Minus, MousePointerClick, Plus } from 'lucide-react';

interface Props {
  floorplan: PestFloorplan;
  imageUrl: string | null;
  stations: PestStation[];
  types: PestStationType[];
  onStationClick: (station: PestStation) => void;
  onPlaceStation: (pos: { x: number; y: number }) => void;
  onMoveStation: (station: PestStation, pos: { x: number; y: number }) => void;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function MarkerShape({
  shape,
  cx,
  cy,
  r,
  fill,
}: {
  shape: 'square' | 'diamond' | 'circle' | 'triangle';
  cx: number;
  cy: number;
  r: number;
  fill: string;
}) {
  const common = { fill, stroke: '#ffffff', strokeWidth: 2 };
  switch (shape) {
    case 'square':
      return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={2} {...common} />;
    case 'diamond':
      return <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} {...common} />;
    case 'triangle':
      return <polygon points={`${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`} {...common} />;
    case 'circle':
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} />;
  }
}

export function FloorplanCanvas({
  floorplan,
  imageUrl,
  stations,
  types,
  onStationClick,
  onPlaceStation,
  onMoveStation,
}: Props) {
  const W = floorplan.width || 1000;
  const H = floorplan.height || 700;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);

  // Misura la larghezza del contenitore per adattare la planimetria.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const baseScale = containerWidth > 0 ? containerWidth / W : 1;
  const dispW = Math.max(1, W * baseScale * zoom);
  const dispH = Math.max(1, H * baseScale * zoom);

  // Raggio del marcatore in unità del viewBox, costante a schermo.
  const markerR = useMemo(() => (12 / (baseScale * zoom)) || 12, [baseScale, zoom]);

  const typeOf = useCallback((id: string | null) => types.find((t) => t.id === id), [types]);

  const toNorm = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  };

  const onBackgroundClick = (e: React.MouseEvent) => {
    const pos = toNorm(e.clientX, e.clientY);
    onPlaceStation(pos);
  };

  const onMarkerPointerDown = (station: PestStation) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (station.pos_x == null || station.pos_y == null) return;
    movedRef.current = false;
    setDragId(station.id);
    setDragPos({ x: station.pos_x, y: station.pos_y });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragId) return;
    movedRef.current = true;
    setDragPos(toNorm(e.clientX, e.clientY));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const stationId = dragId;
    const pos = dragPos;
    setDragId(null);
    setDragPos(null);
    if (!stationId) return;
    const station = stations.find((s) => s.id === stationId);
    if (!station) return;
    if (!movedRef.current) {
      onStationClick(station);
      return;
    }
    if (pos) onMoveStation(station, pos);
  };

  const markers = stations.filter((s) => s.pos_x != null && s.pos_y != null);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MousePointerClick className="h-3.5 w-3.5" />
          Clicca per posizionare · trascina per spostare · clic sul marcatore per aprire la scheda
        </p>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Riduci">
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(5, +(z + 0.25).toFixed(2)))} title="Ingrandisci">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom(1)} title="Adatta">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={wrapRef} className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-muted/30">
        {imageUrl === null ? (
          <div className="grid h-52 place-items-center text-sm text-muted-foreground">Planimetria non disponibile</div>
        ) : (
          <svg
            ref={svgRef}
            width={dispW}
            height={dispH}
            viewBox={`0 0 ${W} ${H}`}
            className="block touch-none select-none"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <rect width={W} height={H} fill="#ffffff" onClick={onBackgroundClick} className="cursor-crosshair" />
            {imageUrl && <image href={imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid meet" pointerEvents="none" />}

            {markers.map((s) => {
              const t = typeOf(s.station_type_id);
              const cat = categoryMeta(t?.category);
              const st = statusMeta(s.status);
              const dragging = dragId === s.id && dragPos;
              const x = (dragging ? dragPos!.x : s.pos_x!) * W;
              const y = (dragging ? dragPos!.y : s.pos_y!) * H;
              return (
                <g
                  key={s.id}
                  transform={`translate(${x} ${y})`}
                  className={dragId === s.id ? 'cursor-grabbing' : 'cursor-pointer'}
                  onPointerDown={onMarkerPointerDown(s)}
                >
                  <MarkerShape shape={cat.shape} cx={0} cy={0} r={markerR} fill={st.hex} />
                  <text
                    x={0}
                    y={markerR + markerR * 0.95}
                    textAnchor="middle"
                    fontSize={markerR * 1.05}
                    fontWeight={700}
                    fill="#0f172a"
                    stroke="#ffffff"
                    strokeWidth={markerR * 0.3}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {s.code}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
