import { getSessionFromRequest } from "@/lib/auth-session";
import { getProfileByAuthUserId, getProfileByGoogleSub } from "@/lib/supabase";
import { Profile } from "@/lib/types";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function resolveProfileFromRequest(request: Request): Promise<Profile | null> {
  const identity = await resolveAuthIdentityFromRequest(request);
  if (!identity) {
    return null;
  }

  const profileByGoogleSub = await getProfileByGoogleSub(identity.googleSub);
  if (profileByGoogleSub) {
    return profileByGoogleSub;
  }

  // Legacy fallback for older records linked before direct Google auth migration.
  if (!isUuid(identity.googleSub)) {
    return null;
  }

  return getProfileByAuthUserId(identity.googleSub);
}

export async function resolveAuthIdentityFromRequest(
  request: Request,
): Promise<{ googleSub: string; email: string | null; name: string | null } | null> {
  const session = getSessionFromRequest(request);
  if (!session) {
    return null;
  }

  return {
    googleSub: session.googleSub,
    email: session.email || null,
    name: session.name || null,
  };
}
