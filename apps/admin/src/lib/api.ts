const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  'http://localhost:3001/api';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    const onLogin = window.location.pathname.startsWith('/login');
    if (!onLogin) {
      // Helper de fetch, no es un Client Component: no hay useRouter acá.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(
        `${window.location.origin}/login?next=${encodeURIComponent(
          window.location.pathname,
        )}`,
      );
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (res.status === 401 && typeof window !== 'undefined') {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`${window.location.origin}/login`);
  }
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<T>;
}
