const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

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
