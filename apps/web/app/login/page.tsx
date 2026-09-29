'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      window.location.href = '/';
    } catch {
      setError('Contraseña incorrecta o demasiados intentos.');
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-xl font-semibold">AndyOS</h1>
        <input
          type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña" className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="w-full rounded-md bg-orange-500 py-2 font-medium text-black hover:bg-orange-400">Entrar</button>
      </form>
    </main>
  );
}
