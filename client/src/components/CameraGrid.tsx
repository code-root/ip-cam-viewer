import type { Camera } from '../api/client';
import { CameraCell } from './CameraCell';
import './CameraGrid.css';

interface Props {
  cameras: Camera[];
  gridSize: number;
  focusedId?: string | null;
  onFocus?: (id: string | null) => void;
  onCameraDeleted?: (id: string) => void;
  onCameraRenamed?: () => void;
  quality?: 'main' | 'sub';
  showControls?: boolean;
}

export function CameraGrid({ cameras, gridSize, focusedId, onFocus, onCameraDeleted, onCameraRenamed, quality, showControls }: Props) {
  const cols = gridSize <= 1 ? 1 : gridSize <= 4 ? 2 : gridSize <= 6 ? 3 : gridSize <= 9 ? 3 : 4;
  const display = focusedId ? cameras.filter((c) => c.id === focusedId) : cameras.slice(0, gridSize);

  return (
    <div
      className="camera-grid"
      style={{ gridTemplateColumns: `repeat(${focusedId ? 1 : cols}, 1fr)` }}
    >
      {display.map((cam) => (
        <CameraCell
          key={cam.id}
          camera={cam}
          quality={focusedId ? 'main' : quality}
          focused={!!focusedId}
          onFocus={() => onFocus?.(focusedId === cam.id ? null : cam.id)}
          onDeleted={() => onCameraDeleted?.(cam.id)}
          onRenamed={onCameraRenamed}
          showControls={showControls}
        />
      ))}
    </div>
  );
}
