import { useRef, useState, useEffect, type ReactNode } from 'react';
import './DigitalZoomPan.css';

interface Props {
  children: ReactNode;
  minScale?: number;
  maxScale?: number;
}

export function DigitalZoomPan({ children, minScale = 1, maxScale = 5 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const limitsRef = useRef({ minScale, maxScale });
  limitsRef.current = { minScale, maxScale };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { minScale: min, maxScale: max } = limitsRef.current;
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setScale((s) => Math.min(max, Math.max(min, s + delta)));
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPos((p) => ({
      x: p.x + e.clientX - last.current.x,
      y: p.y + e.clientY - last.current.y,
    }));
    last.current = { x: e.clientX, y: e.clientY };
  };

  const onMouseUp = () => {
    dragging.current = false;
  };

  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  return (
    <div
      className="digital-zoom-pan"
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div
        className="dzp-inner"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          cursor: scale > 1 ? 'grab' : 'default',
        }}
      >
        {children}
      </div>
      {scale > 1 && (
        <button type="button" className="dzp-reset btn btn-ghost" onClick={reset}>
          1:1
        </button>
      )}
    </div>
  );
}
