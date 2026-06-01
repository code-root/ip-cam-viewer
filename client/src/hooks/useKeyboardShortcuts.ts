import { useEffect } from 'react';

interface Shortcuts {
  onGrid?: (n: number) => void;
  onFullscreen?: () => void;
  onSnapshot?: () => void;
  onRecord?: () => void;
  onPtz?: (dir: { x: number; y: number }) => void;
}

export function useKeyboardShortcuts(shortcuts: Shortcuts, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key >= '1' && e.key <= '9') {
        shortcuts.onGrid?.(parseInt(e.key, 10));
      }
      if (e.key === 'f' || e.key === 'F') shortcuts.onFullscreen?.();
      if (e.key === 's' || e.key === 'S') shortcuts.onSnapshot?.();
      if (e.key === 'r' || e.key === 'R') shortcuts.onRecord?.();
      if (e.key === 'ArrowUp') shortcuts.onPtz?.({ x: 0, y: 1 });
      if (e.key === 'ArrowDown') shortcuts.onPtz?.({ x: 0, y: -1 });
      if (e.key === 'ArrowLeft') shortcuts.onPtz?.({ x: -1, y: 0 });
      if (e.key === 'ArrowRight') shortcuts.onPtz?.({ x: 1, y: 0 });
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts, enabled]);
}
