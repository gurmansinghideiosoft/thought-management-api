export interface ApiResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

/**
 * Tiny JSON HTTP client for integration tests. `raw` is exposed for the cases
 * that need multipart, redirects, or header inspection.
 */
export const makeClient = (baseUrl: string) => {
  const request = async <T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : null) as T,
      headers: res.headers,
    };
  };

  return {
    get: <T = unknown>(path: string) => request<T>('GET', path),
    post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T = unknown>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, body),
    del: <T = unknown>(path: string) => request<T>('DELETE', path),
    raw: (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init),
  };
};

export type ApiClient = ReturnType<typeof makeClient>;
