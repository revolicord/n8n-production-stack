'use client';

import { useEffect, useState } from 'react';

type ToastMsg = { id: number; text: string; ok: boolean };

export function toast(text: string, ok = true): void {
  window.dispatchEvent(new CustomEvent('qc-toast', { detail: { text, ok } }));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([]);

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ text: string; ok: boolean }>).detail;
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, text: detail.text, ok: detail.ok }]);
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 3000);
    }
    window.addEventListener('qc-toast', handler);
    return () => window.removeEventListener('qc-toast', handler);
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((i) => (
        <div
          key={i.id}
          className={`px-4 py-2 rounded shadow-lg text-sm font-medium ${
            i.ok ? 'bg-qc-teal700 text-white' : 'bg-red-700 text-white'
          }`}
        >
          {i.text}
        </div>
      ))}
    </div>
  );
}
