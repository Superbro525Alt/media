"use client";

import type { StateStorage } from "zustand/middleware";
import { createJSONStorage } from "zustand/middleware";
import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = ".pixsort.store.json";

let storePromise: Promise<Store> | null = null;
function getStore() {
  if (!storePromise) storePromise = Store.load(STORE_FILE);
  return storePromise;
}

export function createTauriStorage(): StateStorage {
  return {
    getItem: async (name) => {
      const s = await getStore();
      const v = await s.get(name);
      if (v == null) return null;
      return typeof v === "string" ? v : JSON.stringify(v);
    },
    setItem: async (name, value) => {
      const s = await getStore();
      try {
        await s.set(name, JSON.parse(value));
      } catch {
        await s.set(name, value);
      }
      await s.save();
    },
    removeItem: async (name) => {
      const s = await getStore();
      await s.delete(name);
      await s.save();
    },
  };
}

export const tauriJSONStorage = () => createJSONStorage(createTauriStorage);
