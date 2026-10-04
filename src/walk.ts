import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ignoreModule from "ignore";

// CJS package whose typings declare an ESM default; at runtime the import is the factory itself.
const ignore = ignoreModule as unknown as typeof ignoreModule.default;

const ALWAYS_SKIP = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  "coverage", "vendor", "venv", ".venv", "__pycache__", ".terraform", ".turbo", ".cache", "target",
]);

const MAX_BYTES = 1_000_000;

// Usually gitignored, but exactly where hosts and regions live.
const FORCE_INCLUDE_FILE = [
  /(^|\/)\.env(\.[\w.-]+)?$/,
  /(^|\/)supabase\/\.temp\/pooler-url$/,
  /(^|\/)\.vercel\/project\.json$/,
];
const FORCE_INCLUDE_DIR = [/(^|\/)supabase\/\.temp$/, /(^|\/)\.vercel$/];

export interface ScanContext {
  root: string;
  /** Relative, "/"-separated paths. */
  files: string[];
  read(file: string): string;
}

export function buildContext(root: string): ScanContext {
  const ig = ignore();
  for (const name of [".gitignore", ".residencycheckignore"]) {
    const path = join(root, name);
    if (existsSync(path)) ig.add(readFileSync(path, "utf8"));
  }

  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name)) continue;
        if (ig.ignores(`${rel}/`) && !FORCE_INCLUDE_DIR.some((re) => re.test(rel))) continue;
        visit(abs);
      } else if (entry.isFile()) {
        if (ig.ignores(rel) && !FORCE_INCLUDE_FILE.some((re) => re.test(rel))) continue;
        if (statSync(abs).size > MAX_BYTES) continue;
        files.push(rel);
      }
    }
  };
  visit(root);
  files.sort();

  const cache = new Map<string, string>();
  return {
    root,
    files,
    read(file) {
      let text = cache.get(file);
      if (text === undefined) {
        text = readFileSync(join(root, file), "utf8");
        cache.set(file, text);
      }
      return text;
    },
  };
}

/** 1-based line number of the first occurrence of `needle`, if any. */
export function lineOf(text: string, needle: string): number | undefined {
  const i = text.indexOf(needle);
  return i < 0 ? undefined : text.slice(0, i).split("\n").length;
}
