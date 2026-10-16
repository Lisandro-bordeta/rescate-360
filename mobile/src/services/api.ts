import { config } from '../config/env';

/**
 * Cliente HTTP mínimo con token de sesión inyectado.
 * Se usa fetch nativo (RN 0.73+ incluye fetch WHATWG).
 */

let authToken: string | null = null;

export const setAuthToken = (token: string | null): void => {
  authToken = token;
};

export const getAuthToken = (): string | null => authToken;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${config.API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // respuesta sin cuerpo JSON
    }
    throw new ApiError(res.status, detail);
  }

  return (await res.json()) as T;
};

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
};
