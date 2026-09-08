// Electron's preload pins this to 127.0.0.1:9000 for the desktop UI.
// If opened in a browser during local development (e.g. localhost:3000 or :8080),
// route API requests to backend port 9000.
// If accessed via LAN / shareable domain on port 9000, use same-origin.
const BASE_URL =
  typeof window !== 'undefined' && (window as any).electronAPI?.apiBaseUrl
    ? (window as any).electronAPI.apiBaseUrl
    : typeof window !== 'undefined'
    ? (['3000', '8080', '5173'].includes(window.location.port)
        ? `http://${window.location.hostname}:9000`
        : window.location.origin)
    : 'http://127.0.0.1:9000';

export async function apiFetch(path: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  const contentType = res.headers.get('content-type') || '';
  return contentType.includes('application/json') ? res.json() : res.blob();
}
