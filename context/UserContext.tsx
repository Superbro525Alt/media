"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import type { UserState } from "@/lib/types";
import { GalleryVerticalEnd, AudioWaveform, Command } from "lucide-react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { tauriJSONStorage } from "@/store/storage";

const initialUser: UserState = {
  profile: { name: "shadcn", email: "m@example.com", avatarUrl: "/avatars/shadcn.jpg" },
  subscription: {
    tier: "starter",
    monthlyImageQuota: 200,
    usedThisMonth: 0,
    status: "active",
  },
  collections: [
    { name: "Default",  logo: Command, slug: "acme-inc" },
  ],
  currentCollection: "Default",
};

type UserStore = {
  user: UserState;
  setUser: React.Dispatch<React.SetStateAction<UserState>>;
  incrementUsage: (delta: number) => void;
  setUsage: (next: number) => void;
  setCollection: (collection: string) => void;
};

export const useUser = create<UserStore>()(
  persist(
    (set, get) => ({
      user: initialUser,
      setUser: (updater) =>
        set((state) => {
          const next = typeof updater === "function" ? (updater as any)(state.user) : updater;
          return { user: next };
        }),
      incrementUsage: (delta) => {
        if (!delta) return;
        set((state) => {
          const quota = state.user.subscription.monthlyImageQuota ?? Infinity;
          const used  = Math.max(0, state.user.subscription.usedThisMonth ?? 0);
          const next  = Math.min(quota, used + Math.max(0, delta));
          return { user: { ...state.user, subscription: { ...state.user.subscription, usedThisMonth: next } } };
        });
      },
      setUsage: (next) =>
        set((state) => {
          const quota   = state.user.subscription.monthlyImageQuota ?? Infinity;
          const clamped = Math.min(quota, Math.max(0, next));
          return { user: { ...state.user, subscription: { ...state.user.subscription, usedThisMonth: clamped } } };
        }),
      setCollection: (collection: string) => 
        set((state) => {
          return { user: {...state.user, currentCollection: collection}};
        }),
    }),
    {
      name: "pixsort:user",
      storage: tauriJSONStorage(),
      partialize: (s) => ({
        user: {
          profile: s.user.profile,
          subscription: s.user.subscription,
          currentCollection: s.user.currentCollection
        } as UserState,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        state.setUser((u) => ({
          ...initialUser,
          profile: u.profile ?? initialUser.profile,
          subscription: u.subscription ?? initialUser.subscription,
          currentCollection: u.currentCollection ?? initialUser.currentCollection
        }));
      },
    }
  )
);

// API compatibility (no-op provider)
export function UserProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useRemainingQuota(sessionAdds: number) {
  const quota = useUser((s) => s.user.subscription.monthlyImageQuota ?? 0);
  const used  = useUser((s) => s.user.subscription.usedThisMonth ?? 0);
  return Math.max(0, quota - (used + sessionAdds));
}
