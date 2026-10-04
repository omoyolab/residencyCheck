// Minimal HCL reader: enough structure to find blocks, labels and attribute
// expressions in Terraform files. It doesn't evaluate HCL; values stay raw text.

export interface Attr {
  raw: string;
  line: number;
}

export interface Block {
  type: string;
  labels: string[];
  attrs: Map<string, Attr>;
  blocks: Block[];
  file: string;
  line: number;
}

export function parseHcl(text: string, file: string): Block {
  const root: Block = { type: "", labels: [], attrs: new Map(), blocks: [], file, line: 0 };
  const stack: Block[] = [root];
  const lines = text.split(/\r?\n/);
  const comments = { inBlock: false };

  for (let i = 0; i < lines.length; i++) {
    const line = stripComments(lines[i]!, comments).trim();
    if (!line) continue;
    const top = stack[stack.length - 1]!;

    const attr = line.match(/^([\w-]+)\s*=\s*(.*)$/);
    if (attr) {
      const startLine = i + 1;
      let raw = attr[2]!;
      const heredoc = raw.match(/^<<-?\s*"?(\w+)"?$/);
      if (heredoc) {
        while (i + 1 < lines.length && lines[i + 1]!.trim() !== heredoc[1]) i++;
        i++;
        raw = "<heredoc>";
      } else {
        let depth = balance(raw);
        while (depth > 0 && i + 1 < lines.length) {
          const next = stripComments(lines[++i]!, comments);
          raw += `\n${next}`;
          depth += balance(next);
        }
      }
      top.attrs.set(attr[1]!, { raw: raw.trim(), line: startLine });
      continue;
    }

    const open = line.match(/^([\w-]+)((?:\s+"[^"]*"|\s+[\w-]+)*)\s*\{(.*)$/);
    if (open) {
      const labels = [...open[2]!.matchAll(/"([^"]*)"|([\w-]+)/g)].map((m) => m[1] ?? m[2]!);
      const block: Block = { type: open[1]!, labels, attrs: new Map(), blocks: [], file, line: i + 1 };
      top.blocks.push(block);
      const rest = open[3]!.trim();
      if (!rest.endsWith("}")) stack.push(block);
      continue;
    }

    if (line.startsWith("}") && stack.length > 1) stack.pop();
  }
  return root;
}

function balance(s: string): number {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && inString) { i++; continue; }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    if (ch === "}" || ch === "]" || ch === ")") depth--;
  }
  return depth;
}

function stripComments(line: string, state: { inBlock: boolean }): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (state.inBlock) {
      if (ch === "*" && line[i + 1] === "/") { state.inBlock = false; i++; }
      continue;
    }
    if (ch === "\\" && inString) { out += ch + (line[i + 1] ?? ""); i++; continue; }
    if (ch === '"') inString = !inString;
    if (!inString) {
      if (ch === "#" || (ch === "/" && line[i + 1] === "/")) break;
      if (ch === "/" && line[i + 1] === "*") { state.inBlock = true; i++; continue; }
    }
    out += ch;
  }
  return out;
}

/** All blocks at any depth below `block` with the given type. */
export function descendants(block: Block, type: string): Block[] {
  const out: Block[] = [];
  for (const b of block.blocks) {
    if (b.type === type) out.push(b);
    out.push(...descendants(b, type));
  }
  return out;
}
