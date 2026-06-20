'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Refresca la página (Server Component) en intervalos para reflejar cambios que
 * ocurren fuera del dashboard: escalaciones que entran por el webhook, pausas y
 * reanudaciones disparadas desde Telegram, etc. Sin esto la vista se quedaba
 * "enganchada" hasta un refresh manual.
 *
 * Pausa el ciclo cuando la pestaña no está visible para no martillar al server.
 */
export function AutoRefresh({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    // Refresca al volver a la pestaña tras estar oculta.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, intervalMs]);

  return null;
}
