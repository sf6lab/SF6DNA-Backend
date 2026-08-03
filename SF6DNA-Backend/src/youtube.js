const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

/**
 * YouTube Data API v3 で動画を検索する。
 * @param {string} query 検索キーワード
 * @param {number} maxResults 取得件数(最大10程度を推奨。多いほどクォータ消費が増える)
 */
export async function searchYouTube(query, maxResults = 6) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "YOUTUBE_API_KEY が設定されていません。環境変数を確認してください。"
    );
  }

  const url = new URL(YOUTUBE_SEARCH_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("safeSearch", "strict");
  url.searchParams.set("relevanceLanguage", "ja");
  url.searchParams.set("order", "relevance");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API error: ${res.status} ${body}`);
  }

  const data = await res.json();

  return (data.items || []).map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    thumbnail:
      item.snippet.thumbnails?.medium?.url ||
      item.snippet.thumbnails?.default?.url ||
      "",
    channelTitle: item.snippet.channelTitle,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
  }));
}

/**
 * YouTube動画のURLから動画ID(videoId)を取り出す。
 * 対応形式: youtube.com/watch?v=XXX, youtu.be/XXX, youtube.com/shorts/XXX
 * @param {string} videoUrl
 * @returns {string|null} 抽出できなければnull
 */
export function extractYouTubeVideoId(videoUrl) {
  try {
    const url = new URL(videoUrl);

    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.slice(1).split("/")[0];
      return id || null;
    }

    if (url.hostname.includes("youtube.com")) {
      if (url.pathname.startsWith("/shorts/")) {
        return url.pathname.split("/")[2] || null;
      }
      const v = url.searchParams.get("v");
      if (v) return v;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * YouTube Data API v3 で、指定した動画1件のタイトル・説明文を取得する。
 * AIリプレイコーチング(POST /api/replay/analyze)が、動画URLから
 * タイトル・説明文を得るために使う(searchYouTubeとは異なり、
 * キーワード検索ではなくvideoId指定での単一動画取得)。
 *
 * @param {string} videoId
 * @returns {Promise<{title:string, description:string}|null>} 動画が見つからない場合はnull
 */
export async function getVideoInfo(videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "YOUTUBE_API_KEY が設定されていません。環境変数を確認してください。"
    );
  }

  const url = new URL(YOUTUBE_VIDEOS_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API error: ${res.status} ${body}`);
  }

  const data = await res.json();
  const item = (data.items || [])[0];

  if (!item) return null;

  return {
    title: item.snippet.title || "",
    description: item.snippet.description || "",
  };
}
