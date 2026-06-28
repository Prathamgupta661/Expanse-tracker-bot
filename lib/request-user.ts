import { config } from "@/lib/config";
import { getProfileByTelegramId, getProfileByUserId } from "@/lib/supabase";
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
  const userId = request.headers.get("x-user-id");
  if (userId) {
    return getProfileByUserId(userId);
  }

  const telegramId = request.headers.get("x-telegram-id");
  if (telegramId) {
    const parsed = Number(telegramId);
    if (Number.isFinite(parsed)) {
      return getProfileByTelegramId(parsed);
    }
  }

  const authUserId = await resolveSupabaseAuthUserId(request);
  if (!authUserId) {
    return null;
  }

  // In v1, dashboard clients can still pass x-user-id if they do not map auth user yet.
  return null;
}
