import { useState, type FormEvent } from 'react';
import { ShieldCheck, LogIn, LoaderCircle } from 'lucide-react';

interface LoginScreenProps {
  isLoading: boolean;
  error: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
}

export function LoginScreen({ isLoading, error, onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('admin@infidash.local');
  const [password, setPassword] = useState('admin1234');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onLogin(email, password);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-slate-200/50 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="size-12 rounded-2xl bg-slate-900 flex items-center justify-center text-white">
            <ShieldCheck className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Infidash</h1>
            <p className="text-sm text-slate-500">Acceso seguro al dashboard</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
              autoComplete="email"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-brand-primary/20 transition-all hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            {isLoading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="mt-6 text-xs leading-relaxed text-slate-400">
          Para el MVP local puedes usar la cuenta seed del backend.
        </p>
      </div>
    </div>
  );
}
