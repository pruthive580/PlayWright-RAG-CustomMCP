import * as fs from "node:fs";
import * as path from "node:path";
import { walk } from "./analysis.js";

/**
 * Local vector RAG over the framework's source. Chunks .ts/.md files, embeds
 * each chunk with LM Studio's local embedding model, and answers natural-language
 * queries by cosine similarity. Fully offline — no external services.
 */

const EMB_URL = process.env.LMSTUDIO_EMBED_URL || "http://localhost:1234/v1/embeddings";
const EMB_MODEL = process.env.EMBED_MODEL || "text-embedding-nomic-embed-text-v1.5";
const INDEX_FILE = ".framework-mcp-index.json";

interface Chunk {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
}
interface IndexedChunk extends Chunk {
  vector: number[];
}

/** Sliding-window chunking over a file's lines. */
function chunkFile(root: string, file: string, windowLines = 50, overlap = 12): Chunk[] {
  const rel = path.relative(root, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const chunks: Chunk[] = [];
  const step = Math.max(1, windowLines - overlap);
  for (let start = 0; start < lines.length; start += step) {
    const slice = lines.slice(start, start + windowLines);
    const text = slice.join("\n").trim();
    if (text.length >= 20) {
      chunks.push({
        file: rel,
        startLine: start + 1,
        endLine: Math.min(start + windowLines, lines.length),
        text,
      });
    }
    if (start + windowLines >= lines.length) break;
  }
  return chunks;
}

/** Embed a batch of texts via the local LM Studio embeddings endpoint. */
async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(EMB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMB_MODEL, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Embeddings request failed (${res.status}): ${body}. ` +
        `Ensure LM Studio is running and the '${EMB_MODEL}' embedding model is available.`,
    );
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

/** Build (or rebuild) the embedding index for the framework. */
export async function buildIndex(root: string): Promise<{ chunks: number; files: number }> {
  const files = walk(root).filter((f) => /\.(ts|md)$/.test(f) && !f.endsWith(".d.ts"));
  const chunks: Chunk[] = [];
  for (const f of files) chunks.push(...chunkFile(root, f));

  const indexed: IndexedChunk[] = [];
  const BATCH = 16;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await embed(batch.map((c) => c.text));
    batch.forEach((c, j) => indexed.push({ ...c, vector: vectors[j] }));
  }

  fs.writeFileSync(
    path.join(root, INDEX_FILE),
    JSON.stringify({ model: EMB_MODEL, built: chunks.length, chunks: indexed }),
    "utf8",
  );
  return { chunks: indexed.length, files: files.length };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

export interface RagHit {
  file: string;
  startLine: number;
  endLine: number;
  score: number;
  text: string;
}

/** Semantic search over the framework. Builds the index on first use if missing. */
export async function semanticSearch(root: string, query: string, topK = 6): Promise<RagHit[]> {
  const idxPath = path.join(root, INDEX_FILE);
  if (!fs.existsSync(idxPath)) await buildIndex(root);

  const { chunks } = JSON.parse(fs.readFileSync(idxPath, "utf8")) as { chunks: IndexedChunk[] };
  const [qvec] = await embed([query]);

  return chunks
    .map((c) => ({
      file: c.file,
      startLine: c.startLine,
      endLine: c.endLine,
      score: Number(cosine(qvec, c.vector).toFixed(3)),
      text: c.text.slice(0, 300),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
