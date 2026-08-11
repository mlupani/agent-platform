import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4 bg-ink">
      <div className="w-full max-w-sm panel rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
            Panel del negocio
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Iniciar sesión
          </h1>
          <p className="text-sm text-muted">
            Ingresá con tu usuario y contraseña.
          </p>
        </div>
        <Suspense fallback={<p className="text-sm text-muted">Cargando…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
