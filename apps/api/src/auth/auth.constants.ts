export const ADMIN_SESSION_COOKIE = 'ap_sid';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 días

export type AdminRole = 'ADMIN' | 'USER';

export interface AdminSessionPayload {
  userId: string;
  username: string;
  role: AdminRole;
  displayName?: string | null;
}

export function sessionRedisKey(sid: string) {
  return `auth:sess:${sid}`;
}
