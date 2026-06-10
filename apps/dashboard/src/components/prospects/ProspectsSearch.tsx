'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Buscador de prospectos (único componente cliente del panel). Debounce ~300 ms → `router.push`
 * actualizando `?q=` y reseteando `page`. Enter aplica de inmediato. La URL sigue siendo la
 * fuente de verdad: no guarda estado de datos, solo el texto del input.
 */
export function ProspectsSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sincroniza el input si la URL cambia desde fuera (p.ej. chip "Todas" o navegación atrás).
  useEffect(() => {
    setValue(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function apply(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = next.trim();
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    params.delete('page'); // cambiar la búsqueda resetea la paginación
    router.push(`${pathname}?${params.toString()}`);
  }

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(next), 300);
  }

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (timer.current) clearTimeout(timer.current);
          apply(value);
        }
      }}
      placeholder="Buscar nombre o @usuario…"
      className="w-56 rounded-md border border-qc-border bg-qc-surface px-2.5 py-1 text-[11.5px] text-qc-textBody placeholder:text-qc-textMuted focus:outline-none focus:border-qc-teal700"
    />
  );
}
