import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "cache.sqlite"));
db.pragma("journal_mode = WAL");

// 検索クエリ単位でYouTubeの検索結果をキャッシュする。
// (Render等の無料枠はディスクが再起動で消えることがあるが、
//  あくまでキャッシュなので消えても検索し直すだけで実害はない)
db.exec(`
CREATE TABLE IF NOT EXISTS video_cache (
  query TEXT PRIMARY KEY,
  results TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`);

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間

export function getCachedResults(query) {
  const row = db
    .prepare("SELECT results, fetched_at FROM video_cache WHERE query = ?")
    .get(query);

  if (!row) return null;
  if (Date.now() - row.fetched_at > CACHE_TTL_MS) return null;

  return JSON.parse(row.results);
}

export function setCachedResults(query, results) {
  db.prepare(
    `INSERT INTO video_cache (query, results, fetched_at)
     VALUES (@query, @results, @fetched_at)
     ON CONFLICT(query) DO UPDATE SET
       results = excluded.results,
       fetched_at = excluded.fetched_at`
  ).run({
    query,
    results: JSON.stringify(results),
    fetched_at: Date.now(),
  });
}

export default db;
