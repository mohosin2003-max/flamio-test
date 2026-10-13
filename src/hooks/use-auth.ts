import { useSyncExternalStore } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { clearCustomerDeviceData } from "@/lib/device-privacy";

export type CustomerProfile = {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  avatarPath: string | null;
  avatarUrl: string | null;
};

type AuthSnapshot = {
  session: Session | null;
  user: User | null;
  profile: CustomerProfile | null;
  loading: boolean;
};

/**
 * Single shared source of truth for the customer session. One auth listener,
 * one session read and one profile/photo load for the whole app — every
 * component calling useAuth() reads the same state.
 */
const SERVER_SNAPSHOT: AuthSnapshot = { session: null, user: null, profile: null, loading: true };
let snapshot: AuthSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
let started = false;
let profileRequest = 0;
let loadedProfileFor: string | null = null;

function setSnapshot(patch: Partial<AuthSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

async function loadProfile(userId: string) {
  const request = ++profileRequest;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, phone, email, address_line, avatar_path")
    .eq("id", userId)
    .maybeSingle();
  if (request !== profileRequest) return;

  let avatarUrl: string | null = null;
  if (data?.avatar_path) {
    const { data: signed } = await supabase.storage
      .from("profile-photos")
      .createSignedUrl(data.avatar_path, 60 * 60);
    if (request !== profileRequest) return;
    avatarUrl = signed?.signedUrl ?? null;
  }

  setSnapshot({
    profile: data
      ? {
          id: data.id,
          fullName: data.full_name,
          phone: data.phone,
          email: data.email,
          addressLine: data.address_line,
          avatarPath: data.avatar_path,
          avatarUrl,
        }
      : {
          id: userId,
          fullName: null,
          phone: null,
          email: null,
          addressLine: null,
          avatarPath: null,
          avatarUrl: null,
        },
  });
}

function applySession(next: Session | null) {
  const user = next?.user ?? null;
  const hadUser = snapshot.user != null;
  const userChanged = (user?.id ?? null) !== (snapshot.user?.id ?? null);
  setSnapshot({
    session: next,
    user,
    loading: false,
    ...(userChanged ? { profile: null } : {}),
  });
  if (!user) {
    // Any path that drops a signed-in user (expiry, invalid session, deleted
    // user) must clear device-remembered data, not just the SIGNED_OUT event.
    if (hadUser) clearCustomerDeviceData();
    loadedProfileFor = null;
    profileRequest++;
    return;
  }
  if (loadedProfileFor !== user.id) {
    loadedProfileFor = user.id;
    void loadProfile(user.id);
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  supabase.auth.onAuthStateChange((event, next) => {
    // Covers every sign-out path: logout buttons, session expiry and the
    // foreign-token cleanup in the auth attacher.
    if (event === "SIGNED_OUT") clearCustomerDeviceData();
    applySession(next);
  });

  void supabase.auth.getSession().then(({ data }) => applySession(data.session));
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function refreshProfile() {
  const id = snapshot.user?.id;
  if (id) void loadProfile(id);
}

export function useAuth() {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
  return { ...state, refreshProfile, isAuthenticated: Boolean(state.user) };
}
