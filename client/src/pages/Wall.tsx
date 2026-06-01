import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { camerasApi } from '../api/client';
import { CameraGrid } from '../components/CameraGrid';

export function Wall() {
  const [params] = useSearchParams();
  const grid = parseInt(params.get('grid') || '16', 10);
  const { data } = useQuery({ queryKey: ['cameras'], queryFn: camerasApi.list });

  return (
    <div className="wall-mode" style={{ height: '100vh', padding: 0 }}>
      <CameraGrid cameras={data?.cameras || []} gridSize={grid} quality="sub" showControls={false} />
    </div>
  );
}
