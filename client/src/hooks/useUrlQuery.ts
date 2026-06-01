import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Read/write URL search params with replace (no extra history spam). */
export function useUrlQuery() {
  const [searchParams, setSearchParams] = useSearchParams();

  const get = useCallback((key: string) => searchParams.get(key), [searchParams]);

  const set = useCallback(
    (updates: Record<string, string | null | undefined>, replace = true) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(updates)) {
            if (v === null || v === undefined || v === '') next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace }
      );
    },
    [setSearchParams]
  );

  return useMemo(() => ({ get, set, searchParams }), [get, set, searchParams]);
}
