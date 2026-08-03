import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { getCachedResults, setCachedResults } from "./cache.js";
import { searchYouTube, extractYouTubeVideoId, getVideoInfo } from "./youtube.js";
import { analyzeReplay } from "./openai.js";
import { PROMPT_VERSION } from "./replayPrompt.js";

// このAPI全体の分析ロジックのバージョン(入出力スキーマ・推薦ロジックの版)。
// docs/PHASE7_AI_ANALYSIS_SPEC.md ④ の analysisVersion に対応する。
const ANALYSIS_VERSION = "v1";

const app = express();
app.use(express.json());

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

// AI呼び出しはYouTube検索より1回あたりのコストが高いため、
// /api/replay/ 配下には別枠でより厳しいレート制限をかける。
// (上のlimiterとは別に多重適用される)
const replayLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 1分間に1IPあたり10リクエストまで
  message: { error: "リクエストが多すぎます。しばらく待ってから再度お試しください" },
});
app.use("/api/replay/", replayLimiter);

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

const MEMO_MAX_LENGTH = 500;

/**
 * GET /api/videos/info?url=<YouTube動画URL>
 *
 * AIリプレイコーチング(POST /api/replay/analyze)向けに、動画URLから
 * タイトル・説明文を取得する。/api/videos/search(キーワード検索)とは別に、
 * 単一動画をvideoId指定で取得する。
 *
 * キャッシュは既存のvideo_cacheテーブルを流用し、検索クエリと
 * キー空間が衝突しないよう "video_info:" を前置する(テーブル追加は行わない)。
 */
app.get("/api/videos/info", async (req, res) => {
  const videoUrl = (req.query.url || "").toString().trim();

  if (!videoUrl) {
    return res.status(400).json({ error: "クエリパラメータ url が必要です" });
  }

  const videoId = extractYouTubeVideoId(videoUrl);

  if (!videoId) {
    return res.status(400).json({ error: "YouTubeの動画URLとして解釈できませんでした" });
  }

  const cacheKey = `video_info:${videoId}`;

  try {
    const cached = getCachedResults(cacheKey);
    if (cached) {
      return res.json({ source: "cache", ...cached });
    }

    const info = await getVideoInfo(videoId);

    if (!info) {
      return res.status(404).json({ error: "動画が見つかりませんでした(削除済み・非公開の可能性があります)" });
    }

    setCachedResults(cacheKey, info);

    res.json({ source: "youtube", ...info });
  } catch (err) {
    console.error("[videos/info] failed:", err.message);
    res.status(502).json({ error: "動画情報の取得に失敗しました" });
  }
});

/**
 * POST /api/replay/analyze
 *
 * リクエストボディ(docs/PHASE7_REPLAY_API_SPEC.md ①):
 *   { videoUrl, myCharacterId, opponentCharacterId, videoTitle?, videoDescription?, result?, memo? }
 *
 * videoTitle/videoDescriptionは、フロント側がGET /api/videos/infoで
 * 取得できた場合はその内容が入る。取得に失敗した場合は空文字のまま
 * 送られてくる想定(その場合はconfidenceが下がる形で処理される)。
 */
app.post("/api/replay/analyze", async (req, res) => {
  const body = req.body || {};
  const videoUrl = (body.videoUrl || "").toString().trim();
  const myCharacterId = (body.myCharacterId || "").toString().trim();
  const opponentCharacterId = (body.opponentCharacterId || "").toString().trim();
  const result = body.result === "win" || body.result === "lose" ? body.result : null;
  const memo = (body.memo || "").toString().trim();

  if (!videoUrl || !myCharacterId || !opponentCharacterId) {
    return res.status(400).json({
      error: "videoUrl, myCharacterId, opponentCharacterId は必須です",
    });
  }

  if (myCharacterId === opponentCharacterId) {
    return res.status(400).json({
      error: "myCharacterId と opponentCharacterId が同じです",
    });
  }

  if (memo.length > MEMO_MAX_LENGTH) {
    return res.status(400).json({
      error: `memo は${MEMO_MAX_LENGTH}文字以内で入力してください`,
    });
  }

  const payload = {
    videoTitle: (body.videoTitle || "").toString(),
    videoDescription: (body.videoDescription || "").toString(),
    myCharacterId,
    opponentCharacterId,
    result,
    memo,
  };

  // AI応答が壊れていた場合のみ1回だけ再試行する
  // (docs/PHASE7_REPLAY_BACKEND_DESIGN.md④参照。動画取得失敗はここでは
  //  扱わない。フロント側が空のvideoTitle/videoDescriptionを渡すだけで、
  //  エラーにはせず低confidenceの結果として処理される)
  //
  // ただしOPENAI_API_KEY未設定のような「設定不備」は、リトライしても
  // 結果が変わらず無駄なので即座に失敗させる(④セルフレビューで追加)。
  let aiResult;
  try {
    aiResult = await analyzeReplay(payload);
  } catch (firstErr) {
    if (firstErr.isConfigError) {
      console.error("[replay/analyze] 設定不備のため中断:", firstErr.message);
      return res.status(500).json({ error: "分析機能が利用できません(サーバー設定エラー)" });
    }

    console.error("[replay/analyze] 1回目の分析に失敗、再試行します:", firstErr.message);
    try {
      aiResult = await analyzeReplay(payload);
    } catch (secondErr) {
      console.error("[replay/analyze] 再試行も失敗:", secondErr.message);
      return res.status(500).json({ error: "分析に失敗しました" });
    }
  }

  res.json({
    ...aiResult,
    analysisVersion: ANALYSIS_VERSION,
    aiModel: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    promptVersion: PROMPT_VERSION,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SF6 DNA video API listening on :${PORT}`);
});
