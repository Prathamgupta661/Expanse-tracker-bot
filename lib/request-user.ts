import { config } from "@/lib/config";
import { getProfileByAuthUserId } from "@/lib/supabase";
import { Profile } from "@/lib/types";

export async function resolveSupabaseAuthUserId(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();
  if (!token) {
    return null;
  }

  const response = await fetch(`${config.getSupabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: config.getSupabaseAnonKey(),
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { id?: string };
  return payload.id || null;
}

export async function resolveProfileFromRequest(request: Request): Promise<Profile | null> {
  const authUserId = await resolveSupabaseAuthUserId(request);
  if (!authUserId) {
    return null;
  }

  return getProfileByAuthUserId(authUserId);
}

export async function resolveAuthIdentityFromRequest(
  request: Request,
): Promise<{ authUserId: string; email: string | null } | null> {
  const header = request.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();
  if (!token) {
    return null;
  }

  const response = await fetch(`${config.getSupabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: config.getSupabaseAnonKey(),
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { id?: string; email?: string | null };
  if (!payload.id) {
    return null;
  }

  return {
    authUserId: payload.id,
    email: payload.email || null,
  };
}
