"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useFiles } from "@/context/FilesContext";
import { Wand2, SortAsc, RefreshCw, Trash2 } from "lucide-react";

export function Controls() {
  const { busy, sortBy, setSortBy, runAnalyze, runSortRename, clearAll, items } = useFiles();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3 md:p-4">
      <Button onClick={runAnalyze} disabled={busy || items.length === 0}>
        <Wand2 className="mr-2 h-4 w-4" />
        Analyze & Tag
      </Button>
      <Button onClick={runSortRename} variant="secondary" disabled={busy || items.length === 0}>
        <SortAsc className="mr-2 h-4 w-4" />
        Sort & Rename
      </Button>

      <Separator orientation="vertical" className="mx-1 hidden h-6 md:block" />

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort by</span>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date">Date</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="hue">Hue</SelectItem>
            <SelectItem value="dimension">Dimensions</SelectItem>
            <SelectItem value="tags">Tag Count</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={runAnalyze} disabled={busy || items.length === 0} title="Re-analyze">
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={clearAll} disabled={busy || items.length === 0} title="Clear all">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

