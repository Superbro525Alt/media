"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import React from "react";
import type { LoadedFile, SortKey } from "@/lib/types";
import { analyseMedia } from "@/lib/analyse";
import { tauriJSONStorage } from "@/store/storage";
import { useUser } from "@/context/UserContext";

import * as fs from "@tauri-apps/plugin-fs";
import { cacheDir, join } from "@tauri-apps/api/path";

// ---------- helpers ----------
export function normalizeFsPath(p: string | undefined | null): string | null {
  if (!p) return null;
  const lower = p.toLowerCase();
  // Reject non-fs schemes
  if (
    lower.startsWith("blob:") ||
    lower.startsWith("asset:") ||
    lower.startsWith("http:") ||
    lower.startsWith("https:")
  ) {
    return null;
  }
  // Convert file:// URIs to plain paths
  if (lower.startsWith("file://")) {
    try {
      const u = new URL(p);
      return decodeURIComponent(u.pathname);
    } catch {
      return null;
    }
  }
  return p; // assume absolute fs path already
}

function isDataUrl(s?: string): s is string {
  return !!s && s.startsWith("data:");
}

function isBlobUrl(s?: string): s is string {
  return !!s && s.startsWith("blob:");
}

function dataUrlToUint8(s: string): Uint8Array {
  const comma = s.indexOf(",");
  const meta = s.slice(0, comma);
  const data = s.slice(comma + 1);
  const isBase64 = /;base64/i.test(meta);
  if (isBase64) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } else {
    const txt = decodeURIComponent(data);
    const enc = new TextEncoder();
    return enc.encode(txt);
  }
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function guessMime(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".bmp")) return "image/bmp";
  if (n.endsWith(".tif") || n.endsWith(".tiff")) return "image/tiff";
  return "application/octet-stream";
}

function makeBlobUrlFromFile(file: File): string {
  return URL.createObjectURL(file);
}

// Save bytes into app cache and return absolute fs path
async function stageBytesToCache(bytes: Uint8Array, name: string): Promise<string> {
  const base = await cacheDir();
  const dest = await join(base, "pixsort", "rehydrated", `${crypto.randomUUID()}_${name.replace(/[^\w.\-]+/g, "_")}`);
  await fs.mkdir(await join(base, "pixsort", "rehydrated"), { recursive: true });
  await fs.writeFile(dest, bytes);
  return dest;
}

// ---------- rehydrate builder (with migration) ----------
export async function reconstructTransient(
  it: LoadedFile
): Promise<Partial<LoadedFile> | null> {
  const path = (it as any).path as string | undefined;
  const norm = normalizeFsPath(path);
  const name = (it as any).name || "image";
  const mime = (it as any).type || guessMime(name);
  const createdAt = (it as any).createdAt ?? Date.now();

  try {
    // Case A: we have a valid fs path → read from disk
    if (norm) {
      const bytes = await fs.readFile(norm); // Uint8Array
      const ab = toArrayBuffer(bytes);
      const blob = new Blob([ab], { type: mime });
      const file = new File([blob], name, { type: mime, lastModified: createdAt });
      const src = URL.createObjectURL(blob);
      return { file, src };
    }

    // Case B: legacy/corrupt path but we have a src we can decode → migrate
    const persistedSrc = (it as any).src as string | undefined;

    // B1: data URL persisted
    if (isDataUrl(persistedSrc)) {
      const bytes = dataUrlToUint8(persistedSrc);
      const newPath = await stageBytesToCache(bytes, name);
      const blob = new Blob([toArrayBuffer(bytes)], { type: mime });
      const file = new File([blob], name, { type: mime, lastModified: createdAt });
      const src = URL.createObjectURL(blob);
      return { file, src, path: newPath };
    }

    // B2: blob URL persisted — fetch bytes from the blob URL
    if (isBlobUrl(persistedSrc)) {
      const resp = await fetch(persistedSrc);
      const blob = await resp.blob();
      const ab = await blob.arrayBuffer();
      const u8 = new Uint8Array(ab);
      const newPath = await stageBytesToCache(u8, name);
      const file = new File([blob], name, { type: mime, lastModified: createdAt });
      const src = URL.createObjectURL(blob);
      return { file, src, path: newPath };
    }

    console.warn("rehydrate: no valid fs path or decodable src for", (it as any).id, { path, src: persistedSrc });
    return null;
  } catch (e) {
    console.warn("rehydrate: failed for", (it as any).id, e);
    return null;
  }
}

// ---------------- types ----------------
type FileData = { file: File; path: string };

type FilesStore = {
  items: LoadedFile[];
  busy: boolean;
  sortBy: SortKey;
  setSortBy: (k: SortKey) => void;
  clearAll: () => void;
  addFiles: (files: FileData[], collection: string) => Promise<void>;
  deleteFile: (src: string) => void;
  analysePost: (src: string) => Promise<void>;
};

// ---------------- store ----------------
export const useFiles = create<FilesStore>()(
  persist(
    (set, get) => ({
      items: [],
      busy: false,
      sortBy: "date",
      setSortBy: (k) => set({ sortBy: k }),

      clearAll: () => {
        const cur = useFiles.getState().items;
        for (const it of cur) {
          if ((it as any).src) {
            try { URL.revokeObjectURL((it as any).src as string); } catch {}
          }
        }
        set({ items: [] });
      },

      addFiles: async (files: FileData[], collection: string) => {
        set({ busy: true });
        try {
          const mapped: LoadedFile[] = await Promise.all(
            files.map(async ({ file, path }) => {
              const type = file.type || guessMime(file.name);
              const src = makeBlobUrlFromFile(file); // runtime-only
              return {
                id: crypto.randomUUID(),

                file,
                src,

                path, // MUST be absolute fs path; never a blob/data/asset URL
                name: file.name,
                type,
                sizeKB: Math.round(file.size / 1024),
                createdAt: Date.now(),
                collection,
              } as unknown as LoadedFile;
            })
          );

          const withTags = await analyseMedia(mapped);
          console.log(withTags)
          set((state) => ({ items: [...state.items, ...withTags] }));
          useUser.getState().incrementUsage(withTags.length);
        } finally {
          set({ busy: false });
        }
      },

      deleteFile: (src: string) => {
        set((state) => ({ items: [...state.items.filter((i) => i.path != src)] }));
      },

      analysePost: async (src: string) => {
        set({ busy: true });
        let item: LoadedFile = get().items.filter((f) => f.path == src)[0];
        item.analysis = undefined;
        const tagged = await analyseMedia([item]);
        console.log(tagged)
        set((state) => ({ items: [...state.items.filter((f) => f.path != src), ...tagged]}))
        set({ busy: false });
      }
    }),
    {
      name: "pixsort:files",
      storage: tauriJSONStorage(),

      // Persist everything except transient fields
      partialize: (s) => ({
        sortBy: s.sortBy,
        items: s.items.map(({ file, src, ...rest }) => rest),
      }),

      // Rebuild File & src after hydration; migrate bad paths into cache
      onRehydrateStorage: () => async (state) => {
        const items = state?.items ?? [];
        if (!items.length) return;

        await Promise.all(
          items.map(async (it) => {
            const restored = await reconstructTransient(it as any);
            if (restored) {
              useFiles.setState((cur) => ({
                items: cur.items.map((x) => {
                  if (x.id !== (it as any).id) return x;

                  // Revoke old blob url if replaced
                  if ((x as any).src && restored.src && (x as any).src !== restored.src) {
                    try { URL.revokeObjectURL((x as any).src as string); } catch {}
                  }

                  return { ...x, ...restored } as LoadedFile;
                }),
              }));
            }
          })
        );
      },

      version: 1,
    }
  )
);

// API compatibility (no-op provider)
export function FilesProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
