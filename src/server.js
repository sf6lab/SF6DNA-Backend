import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { getCachedResults, setCachedResults } from "./cache.js";
import { searchYouTube } from "./youtube.js";

const app = express();

// フロントエンド(GitHub Pages)からのアクセスのみ許可する。
// 未設定の場合は開発中は全許可にしておくが、公開後は必ず
// ALLOWED_ORIGIN を自分のGitHub Pagesのドメインに設定すること。
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({ origin: allowedOrigin }));

// YouTube APIのクォータを守るため、叩きすぎを防ぐレート制限
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 1分間に1IPあたり30リクエストまで
});
app.use("/api/", limiter);

app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * GET /api/videos/search?q=<検索キーワード>&max=<件数>
 *
 * qはフロントエンド側で組み立てた検索クエリをそのまま渡す想定。
 * 例: 「リュウ 初心者 コンボ ストリートファイター6」
 *
 * 同じqへのリクエストは24時間キャッシュを返す(クォータ節約のため)。
 */
app.get("/api/videos/search", async (req, res) => {
  const query = (req.query.q || "").toString().trim();
  const maxResults = Math.min(Number(req.query.max) || 6, 10);

  if (!query) {
    return res.status(400).json({ error: "クエリパラメータ q が必要です" });
  }

  try {
    const cached = getCachedResults(query);
    if (cached) {
      return res.json({ source: "cache", results: cached });
    }

    const results = await searchYouTube(query, maxResults);
    setCachedResults(query, results);

    res.json({ source: "youtube", results });
  } catch (err) {
    console.error("[videos/search] failed:", err.message);
    res.status(502).json({ error: "動画の取得に失敗しました" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SF6 DNA video API listening on :${PORT}`);
});
