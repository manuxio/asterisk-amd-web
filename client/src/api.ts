import type {
  DetectionFilters,
  DetectionPage,
  Me,
  ServerInfo,
  Stats,
} from '../../shared/types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    let msg = `errore ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* risposta non JSON: resta il codice di stato */
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export function queryString(f: DetectionFilters): string {
  const p = new URLSearchParams();
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.q) p.set('q', f.q);
  if (f.operator) p.set('operator', f.operator);
  if (f.state) p.set('state', f.state);
  if (f.onlyDetected) p.set('detected', '1');
  if (f.onlyAudio) p.set('audio', '1');
  if (f.limit != null) p.set('limit', String(f.limit));
  if (f.offset != null) p.set('offset', String(f.offset));
  return p.toString();
}

export const api = {
  me: () => req<Me>('/api/me'),

  login: (username: string, password: string) =>
    req<Me>('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),

  logout: () => req<{ ok: boolean }>('/api/logout', { method: 'POST' }),

  info: () => req<ServerInfo>('/api/info'),

  detections: (f: DetectionFilters) => req<DetectionPage>(`/api/detections?${queryString(f)}`),

  operators: (from: string, to: string) =>
    req<{ operators: string[] }>(`/api/operators?from=${from}&to=${to}`),

  stats: (from: string, to: string) => req<Stats>(`/api/stats?from=${from}&to=${to}`),

  summary: () => req<{ today: Stats; yesterday: Stats }>('/api/summary'),
};

export const audioUrl = (id: number) => `/api/audio/${id}`;
export const downloadUrl = (id: number) => `/api/audio/${id}?download=1`;
export const csvUrl = (f: DetectionFilters) =>
  `/api/export.csv?${queryString({ ...f, limit: undefined, offset: undefined })}`;
