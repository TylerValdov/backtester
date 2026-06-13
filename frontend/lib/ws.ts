// WebSocket helper for live paper trading.
//
// The WS connects directly to the backend (not through the Next rewrite —
// rewrites don't proxy WebSocket upgrades). Cookies on localhost are
// port-agnostic so the session cookie authenticates the handshake; a
// short-lived token from /api/auth/ws-token is the fallback for setups where
// the cookie doesn't reach the backend host.

import { api } from "./api";

// In production the WebSocket is proxied on the same domain (/ws/* via the
// reverse proxy), so default to same-origin. Override with NEXT_PUBLIC_WS_ORIGIN
// for split-host setups; falls back to the dev backend port server-side.
const WS_BASE =
  process.env.NEXT_PUBLIC_WS_ORIGIN ??
  (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "ws://localhost:8000");

export async function openPaperSocket(sessionId: string): Promise<WebSocket> {
  let tokenPart = "";
  try {
    const { token } = await api.get<{ token: string }>("/api/auth/ws-token");
    tokenPart = `?token=${encodeURIComponent(token)}`;
  } catch {
    // fall back to cookie auth on the handshake
  }
  return new WebSocket(`${WS_BASE}/ws/paper/${sessionId}${tokenPart}`);
}
