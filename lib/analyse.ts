import { invoke } from "@tauri-apps/api/core";
import { merge, type AnalysedFile, type LoadedFile, type MediaAnalysis } from "./types";

export async function analyseMedia(files: LoadedFile[]): Promise<LoadedFile[]> {
  const analysis = (await invoke("analyse_file", { files })) as MediaAnalysis[];
  if (analysis.length !== files.length) throw new Error(`analyse_file returned ${analysis.length} analyses for ${files.length} files`);
  return analysis.map((a, i) => {
    return {...files[i], analysis: a}
  });
}

