import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeFileSafe(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

export async function appendLog(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, content, "utf8");
}

async function walkFiles(root: string, collector: string[]): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, collector);
    } else if (entry.isFile()) {
      collector.push(fullPath);
    }
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export async function listFiles(root: string, glob?: string): Promise<string[]> {
  const files: string[] = [];
  await walkFiles(root, files);

  if (!glob) {
    return files;
  }

  const regex = globToRegex(glob);
  return files.filter((filePath) => {
    const relativePath = path.relative(root, filePath).replace(/\\/g, "/");
    return regex.test(relativePath);
  });
}

export interface SearchResult {
  filePath: string;
  matches: number;
}

export async function searchInFiles(root: string, query: string): Promise<SearchResult[]> {
  const files = await listFiles(root);
  const results: SearchResult[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      if (!content.includes(query)) {
        continue;
      }
      const matches = content.split(query).length - 1;
      results.push({ filePath, matches });
    } catch {
      // Skip unreadable or binary-like files.
    }
  }

  return results;
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  const serialized = `${JSON.stringify(data, null, 2)}\n`;

  await fs.writeFile(tempPath, serialized, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  const content = await readFileSafe(filePath);
  if (!content) {
    return null;
  }
  return JSON.parse(content) as T;
}
