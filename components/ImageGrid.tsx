"use client";

import React from "react";
import { Plus } from "lucide-react";
import { useFiles } from "@/context/FilesContext";
import { useRemainingQuota, useUser } from "@/context/UserContext";
import { Skeleton } from "@/components/ui/skeleton";

// --- Tauri v2 APIs ---
import { open } from "@tauri-apps/plugin-dialog";
import * as fs from "@tauri-apps/plugin-fs";
import { cacheDir, join, extname, basename } from "@tauri-apps/api/path";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Pencil, Trash2, Eye, Download, MoreHorizontal } from "lucide-react";
import { OrbitProgress } from "react-loading-indicators";
import { Spinner } from "./ui/shadcn-io/spinner";

// ---------- utils ----------
const fmtSize = (kb: number) => {
  const b = kb * 1024;
  if (b < 1024) return `${b.toFixed(0)} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(2)} MB`;
};

const guessMime = async (name: string): Promise<string> => {
  const ext = (await extname(name)).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".tiff" || ext === ".tif") return "image/tiff";
  return "application/octet-stream";
};

const isBlobLike = (s?: string) => !!s && (s.startsWith("blob:") || s.startsWith("data:"));

// Convert disk paths → { path, file }
async function pathsToEntries(paths: string[]) {
  const out: { path: string; file: File }[] = [];
  for (const p of paths) {
    const data = await fs.readFile(p); // Uint8Array
    const name = await basename(p);
    const type = await guessMime(name);
    // Convert Uint8Array to real ArrayBuffer slice to keep TS happy
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const blob = new Blob([ab], { type });
    const file = new File([blob], name, { type });
    out.push({ path: p, file });
  }
  return out;
}

// Persist a File (from paste/drag) into cache to get a real path
async function stageFileToCache(file: File) {
  const dir = await cacheDir();
  const safeName = `${crypto.randomUUID()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
  const dest = await join(dir, "image-grid", safeName);
  const buf = new Uint8Array(await file.arrayBuffer());
  await fs.mkdir(await join(dir, "image-grid"), { recursive: true });
  await fs.writeFile(dest, buf);
  return dest;
}

async function filesToEntries(files: File[]) {
  const out: { path: string; file: File }[] = [];
  for (const f of files) {
    const stagedPath = await stageFileToCache(f);
    out.push({ path: stagedPath, file: f });
  }
  return out;
}

// ---------- UI bits ----------
function AddTile({
  busy,
  over,
  onPick,
  onChange,
  disabled,
}: {
  busy: boolean;
  over: boolean;
  onPick: () => void;
  onChange: (files: FileList | null) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onPick}
      disabled={busy || disabled}
      className={[
        "group relative aspect-square rounded-2xl border outline-none transition",
        "border-white/15 bg-white/5 backdrop-blur",
        "hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary/50",
        over ? "ring-1 ring-primary/40" : "",
        disabled ? "cursor-not-allowed opacity-60" : "",
      ].join(" ")}
      title={disabled ? "Monthly limit reached" : "Add images"}
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(transparent_1px,_rgba(255,255,255,0.05)_1px)] [background-size:10px_10px]" />
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center">
          <div className="rounded-full border border-white/20 bg-white/10 p-3 backdrop-blur transition group-hover:scale-105 group-hover:bg-white/20">
            <Plus className="h-5 w-5" />
          </div>
          <span className="mt-2 text-xs text-muted-foreground">
            {disabled ? "Limit reached" : "Add"}
          </span>
        </div>
      </div>

      {/* Hidden input as a fallback / for paste-triggered clicks if you want */}
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => onChange(e.target.files)}
      />
    </button>
  );
}

type Props = {
  name: string;
  src?: string;
  path?: string;
  type?: string;
  sizeKB: number;
  renamed?: string;

  onEditAction?: (info: { name: string; path?: string; src?: string }) => void;
  onDeleteAction?: (info: { name: string; path?: string; src?: string }) => void;
  onOpenAction?: (info: { name: string; path?: string; src?: string }) => void;
  onDownloadAction?: (info: { name: string; path?: string; src?: string }) => void;

  extraActions?: Array<{
    label: string;
    onClick: (info: { name: string; path?: string; src?: string }) => void;
    icon?: React.ReactNode;
  }>;
};

export function ImageCard({
  name,
  src,      // may be a blob URL from state (preferred)
  path,     // absolute fs path (used to build a blob if src is absent/non-blob)
  type,     // mime type (optional but helps)
  sizeKB,
  renamed,

  onEditAction,
  onDeleteAction,
  onOpenAction,
  onDownloadAction,
  extraActions,
}: Props) {
  const [loaded, setLoaded] = React.useState(false);
  const [imgSrc, setImgSrc] = React.useState<string | null>(null);

  React.useEffect(() => {
    let revoke: string | null = null;

    (async () => {
      // If we already have a blob/data URL, just use it.
      if (isBlobLike(src)) {
        setImgSrc(src!);
        return;
      }

      // Otherwise, if we have a filesystem path, read bytes and create a blob URL.
      if (path) {
        try {
          const bytes = await fs.readFile(path);
          const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          const mime = type || (await guessMime(name));
          const blob = new Blob([ab], { type: mime });
          const url = URL.createObjectURL(blob);
          setImgSrc(url);
          revoke = url;
        } catch (e) {
          console.error("readFile failed:", e);
          setImgSrc(null);
        }
        return;
      }

      // No usable source
      setImgSrc(null);
    })();

    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [src, path, type, name]);

  const info = React.useMemo(() => ({ name, path, src: (imgSrc ?? src ?? null) || undefined }), [name, path, src, imgSrc]);

  return (
    <div
      className={[
        "group relative overflow-hidden rounded-2xl border transition",
        "border-white/10 bg-white/5 backdrop-blur",
        "hover:shadow-sm hover:shadow-black/10",
        // Make actions visible when focusing any child (keyboard users)
        "focus-within:ring-1 focus-within:ring-white/20",
      ].join(" ")}
      title={renamed ?? name}
      tabIndex={-1}
    >
      <div
        className={[
          "pointer-events-none absolute inset-x-0 top-0 z-10",
          "flex items-center justify-end gap-1 p-2",
          "opacity-0 transition-opacity duration-150",
          "group-hover:opacity-100 group-focus-within:opacity-100",
        ].join(" ")}
      >
        <TooltipProvider disableHoverableContent>
          <div className="flex items-center gap-1 pointer-events-auto">
            {onOpenAction && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 rounded-full bg-black/40 text-white hover:bg-black/60 border border-white/10"
                    aria-label="Open"
                    onClick={(e) => { e.stopPropagation(); onOpenAction(info); }}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Open</TooltipContent>
              </Tooltip>
            )}

            {onEditAction && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 rounded-full bg-black/40 text-white hover:bg-black/60 border border-white/10"
                    aria-label="Edit"
                    onClick={(e) => { e.stopPropagation(); onEditAction(info); }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Edit</TooltipContent>
              </Tooltip>
            )}

            {onDownloadAction && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 rounded-full bg-black/40 text-white hover:bg-black/60 border border-white/10"
                    aria-label="Download"
                    onClick={(e) => { e.stopPropagation(); onDownloadAction(info); }}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Download</TooltipContent>
              </Tooltip>
            )}

            {onDeleteAction && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="destructive"
                    className="h-8 w-8 rounded-full bg-red-600/80 hover:bg-red-600 text-white border border-white/10"
                    aria-label="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteAction(info);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Delete</TooltipContent>
              </Tooltip>
            )}

            {(extraActions && extraActions.length > 0) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 rounded-full bg-black/40 text-white hover:bg-black/60 border border-white/10"
                    aria-label="More"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
                  {extraActions.map((a, i) => (
                    <DropdownMenuItem
                      key={i}
                      onClick={(e) => { e.stopPropagation(); a.onClick(info); }}
                      className="gap-2"
                    >
                      {a.icon ?? null}
                      {a.label}
                    </DropdownMenuItem>
                  ))}
                  {/* optional separator for future items */}
                  {/* <DropdownMenuSeparator /> */}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </TooltipProvider>
      </div>

      {/* Image body */}
      <div className="relative aspect-square bg-muted">
        {(!loaded || !imgSrc) && (
          <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {imgSrc && (
          <img
            src={imgSrc}
            alt={name}
            className={[
              "h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]",
              loaded ? "opacity-100" : "opacity-0",
            ].join(" ")}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
        )}

        {/* Bottom gradient strip (filename + size) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/40 to-transparent p-2 text-[11px] text-white/90 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          <span className="truncate">{renamed ?? name}</span>
          <span className="shrink-0 tabular-nums">{fmtSize(sizeKB)}</span>
        </div>
      </div>
    </div>
  );
}

function BusySkeletonGrid() {
  return (
    <div className="flex flex-row items-center justify-center h-full">
      <Spinner variant="ellipsis" />
    </div>
  );
}

// ---------- main ----------
export function ImageGrid() {
  const { user } = useUser();
  const { items, addFiles, busy, deleteFile, analysePost } = useFiles(); // addFiles expects { path, file }[]
  const [over, setOver] = React.useState(false);

  const sessionAdds = items.length;
  const remaining = useRemainingQuota(sessionAdds);
  const canAdd = remaining > 0;

  // Tauri-native picker (returns absolute paths)
  const pick = async () => {
    if (!canAdd) return;
    const result = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff"] }],
    });
    const picked = Array.isArray(result) ? result : result ? [result] : [];
    if (picked.length === 0) return;

    const limited = picked.slice(0, remaining);
    const entries = await pathsToEntries(limited);
    if (entries.length) {
      await addFiles(entries, user.currentCollection);
    }
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0 || !canAdd) return;
    const allowed = Array.from(list).slice(0, remaining);
    const entries = await filesToEntries(allowed);
    if (entries.length) {
      await addFiles(entries, user.currentCollection);
    }
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    await handleFiles(e.dataTransfer.files);
  };

  React.useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData || !canAdd) return;
      const files = Array.from(e.clipboardData.files);
      if (files.length) {
        e.preventDefault();
        const allowed = files.slice(0, remaining);
        const entries = await filesToEntries(allowed);
        if (entries.length) {
          await addFiles(entries, user.currentCollection);
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles, canAdd, remaining, user.currentCollection]);

  if (items.length === 0) {
    return (
      <div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={[
            "grid place-items-center rounded-3xl border-2 border-dashed p-14 text-center transition",
            "border-white/15 bg-white/5 backdrop-blur",
            over ? "ring-1 ring-primary/40" : "",
          ].join(" ")}
        >
          {busy ? (
            <div className="w-full max-w-xl">
              <Skeleton className="mx-auto h-48 w-full rounded-2xl" />
              <div className="mt-4 flex justify-center gap-2">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-8 w-28" />
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={pick}
                disabled={!canAdd}
                className={[
                  "group flex flex-col items-center outline-none",
                  "focus-visible:ring-2 focus-visible:ring-primary/50",
                  !canAdd ? "cursor-not-allowed opacity-60" : "",
                ].join(" ")}
                title={canAdd ? "Add images" : "Monthly limit reached"}
              >
                <div className="rounded-full border border-white/20 bg-white/10 p-4 backdrop-blur transition group-hover:scale-105 group-hover:bg-white/20">
                  <Plus className="h-7 w-7" />
                </div>
                <span className="mt-3 text-sm text-muted-foreground">
                  {canAdd ? "Drop images, paste, or click to add" : "Monthly limit reached"}
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {busy ? (
        <BusySkeletonGrid />
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 overflow-scroll"
        >
          <AddTile
            busy={busy}
            over={over}
            onPick={pick}
            onChange={handleFiles}
            disabled={!canAdd}
          />
          {items.map((it) => (
            <ImageCard
              key={it.id}
              name={it.name}
              src={it.src}          // if present and blob/data, used directly
              path={it.path}        // otherwise we read from this absolute fs path
              type={it.type}
              sizeKB={it.sizeKB}
              renamed={it.renamed}
              onDeleteAction={(i) => deleteFile(i.path!)}
              extraActions={[
                { label: "Analyze", icon: <Eye className="h-4 w-4" />, onClick: async (i) => await analysePost(i.path!) }
              ]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
