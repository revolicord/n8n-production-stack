'use client';

import { IconChartBar } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError('Contraseña incorrecta');
      return;
    }
    startTransition(() => router.push('/'));
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-qc-bg">
      <div
        className="border border-qc-border rounded-xl p-8 w-full max-w-sm"
        style={{ background: '#111111' }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="rounded-md flex items-center justify-center flex-shrink-0"
            style={{ width: 28, height: 28, background: '#0f6e56' }}
          >
            <IconChartBar size={15} className="text-qc-teal50" />
          </div>
          <h1 className="text-[15px] font-medium text-white">Quantum Dashboard</h1>
        </div>

        <form onSubmit={onSubmit}>
          <label
            htmlFor="password"
            className="block text-[11px] text-qc-textMuted mb-1.5 uppercase tracking-wider font-medium"
          >
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-qc-bg border border-qc-borderHover rounded px-3 py-2 text-sm text-white focus:border-qc-teal500 focus:outline-none mb-3"
            placeholder="••••••••"
            required
          />
          {error && <p className="text-xs text-qc-danger mb-3">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-qc-teal700 hover:bg-qc-teal500 text-white font-medium rounded py-2 text-sm transition-colors disabled:opacity-60"
          >
            {isPending ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
