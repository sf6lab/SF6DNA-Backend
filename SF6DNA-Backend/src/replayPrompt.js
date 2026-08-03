// AIリプレイコーチング: OpenAIへ渡すプロンプトの組み立て。
// docs/PHASE7_REPLAY_API_SPEC.md ④ の内容をそのままテンプレート化したもの。
// プロンプトの版はPROMPT_VERSIONで管理し、変更する際はここを更新した上で
// server.js側のレスポンスに含まれるpromptVersionと一致させる。

export const PROMPT_VERSION = "p1";

const AXIS_KEYS = [
  "aggressive",
  "defensive",
  "zoning",
  "balanced",
  "reading",
  "combo",
  "strategy",
  "instinct",
];

export function buildSystemPrompt() {
  return `あなたはStreet Fighter 6のプレイヤーの試合を分析し、勝敗ではなく改善行動を
提案するコーチです。

以下のルールを厳守してください。

1. 出力は必ず指定されたJSON形式のみとし、前置き・後書き等の文章を含めないこと
2. axisのキーは以下の8種類のみを使用すること:
   ${AXIS_KEYS.join(" / ")}
3. 動画の映像そのものは見ることができない。タイトル・説明文・入力情報から
   読み取れる内容のみを根拠にすること
4. 動画を実際に見たかのような具体的な描写(「◯フレーム目で〜」等)を
   生成しないこと。入力に無い具体的なプレイ内容を創作しないこと
5. わからないことは、それらしく補完せず「判定不能」と答えること
6. 断定的な言い切りを避け、「〜かもしれません」「〜の可能性があります」等、
   伴走者としての提案口調にすること
7. axisは最大3件まで。各要素にはscore(0〜1)とreason(判定理由)を含めること
8. recommendedTraining等のフィールドは出力に含めないこと(このAPIの
   応答範囲外)`;
}

/**
 * @param {{videoTitle?:string, videoDescription?:string, myCharacterId:string, opponentCharacterId:string, result?:string|null, memo?:string}} payload
 */
export function buildUserPrompt(payload) {
  const videoTitle = payload.videoTitle || "(取得できませんでした)";
  const videoDescription = payload.videoDescription || "(取得できませんでした)";
  const result = payload.result || "不明";
  const memo = payload.memo || "なし";

  return `以下の情報をもとに、この試合を分析してください。
動画の映像そのものは見ることができないため、
タイトル・説明文・入力情報から読み取れる内容のみを根拠にしてください。

【動画情報】
タイトル: ${videoTitle}
説明文: ${videoDescription}

【プレイヤー情報】
自キャラクター: ${payload.myCharacterId}
相手キャラクター: ${payload.opponentCharacterId}
試合結果: ${result}
任意メモ: ${memo}`;
}

export { AXIS_KEYS };
