import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const repoDirectory = /^(?:src|docs|drizzle|scripts|tests|public)\//;
const extension =
  /\.(?:astro|[cm]?js|jsx|tsx?|json|md|css|sql|ya?ml|svg|png|jpe?g|webp|ico|html|sh|toml|patch)$/i;

export interface DocPathFailure {
  doc: string;
  line: number;
  path: string;
}

/** Check repository paths named by the documentation under a repository root. */
export async function checkDocPaths(root: string): Promise<DocPathFailure[]> {
  const docs = ["CLAUDE.md", "README.md", "CONTEXT.md"];
  async function collect(directory: string) {
    for (const entry of (
      await readdir(join(root, directory), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.name.endsWith(".md")) docs.push(path);
    }
  }
  await collect("docs");
  const failures: DocPathFailure[] = [];
  for (const doc of docs) {
    let content: string;
    try {
      content = await readFile(join(root, doc), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    let fence: string | undefined;
    for (const [index, line] of content.split("\n").entries()) {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
          fence = undefined;
        continue;
      }
      if (fence) continue;
      const candidates = [
        ...Array.from(line.matchAll(/(`+)(.*?)\1/g)).flatMap((match) =>
          match[2].split(/\s+/).map((path) => ({ path, link: false }))
        ),
        ...Array.from(
          line.matchAll(/\]\(<?([^\s)]+?)>?(?:\s+["'][^"']*["'])?\)/g),
          (match) => ({ path: match[1], link: true })
        ),
      ];
      const seen = new Set<string>();
      for (const candidate of candidates) {
        const path = candidate.path.split(/[?#]/)[0];
        if (/[*<>…]|NNNN|[a-z][a-z0-9+.-]*:/i.test(candidate.path)) continue;
        if (!repoDirectory.test(path) && !extension.test(path)) continue;
        if (seen.has(path)) continue;
        seen.add(path);
        // Explicit repo directories are root-relative; other links follow Markdown's document-relative convention.
        const base =
          candidate.link && !repoDirectory.test(path) ? dirname(doc) : "";
        try {
          const entry = await stat(join(root, base, path));
          if (path.endsWith("/") && !entry.isDirectory()) {
            failures.push({ doc, line: index + 1, path });
          }
        } catch (error) {
          if (
            !["ENOENT", "ENOTDIR"].includes(
              (error as NodeJS.ErrnoException).code ?? ""
            )
          )
            throw error;
          failures.push({ doc, line: index + 1, path });
        }
      }
    }
  }
  return failures;
}
