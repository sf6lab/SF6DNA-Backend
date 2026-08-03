import { buildSystemPrompt, buildUserPrompt, AXIS_KEYS } from "./replayPrompt.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30000;

// docs/PHASE7_AI_ANALYSIS_SPEC.md ④(a) のスキーマをOpenAIのStructured Outputs
// (response_format: json_schema)で強制する。
// 実装時点でOpenAIの最新ドキュメントと突き合わせて仕様に変更が無いか確認すること。
const REPLAY_ANALYSIS_JSON_SCHEMA = {
  name: "replay_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      strengths: { type: "array", items: { type: "string" } },
      weaknesses: { type: "array", items: { type: "string" } },
      axis: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            axis: { type: "string", enum: AXIS_KEYS },
            score: { type: "number" },
            reason: { type: "string" },
          },
          required: ["axis", "score", "reason"],
        },
      },
    },
    required: ["confidence", "strengths", "weaknesses", "axis"],
  },
};

/**
 * OpenAI APIへリプレイ分析を1回だけ依頼する(リトライは呼び出し側の責務)。
 *
 * @param {{videoTitle?:string, videoDescription?:string, myCharacterId:string, opponentCharacterId:string, result?:string|null, memo?:string}} payload
 * @returns {Promise<{confidence:string, strengths:string[], weaknesses:string[], axis:Array}>}
 */
export async function analyzeReplay(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  if (!apiKey) {
    // 設定不備であり、リトライしても結果は変わらないため、呼び出し側が
    // 判別できるよう専用のエラー型で即座に失敗させる(④参照)。
    const err = new Error(
      "OPENAI_API_KEY が設定されていません。環境変数を確認してください。"
    );
    err.isConfigError = true;
    throw err;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(payload) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: REPLAY_ANALYSIS_JSON_SCHEMA,
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`OpenAI APIがタイムアウトしました(${timeoutMs}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${body}`);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message;

  // Structured Outputsがモデル側の都合で拒否された場合、
  // contentではなくrefusalに理由が入る
  if (message?.refusal) {
    throw new Error(`OpenAI APIが応答を拒否しました: ${message.refusal}`);
  }

  const content = message?.content;

  if (!content) {
    throw new Error("OpenAI APIの応答にcontentがありません");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`OpenAI APIの応答がJSONとして解釈できません: ${err.message}`);
  }

  validateReplayAnalysisShape(parsed);

  return parsed;
}


/**
 * OpenAI応答のスキーマを検証する(①②の要件: axis/confidence/strengths/
 * weaknessesが必ず正しい型で揃っていることを保証する)。
 * response_format(strict:true)により通常はOpenAI側で保証されるはずだが、
 * AIの応答を無条件に信頼せず、ここでも防御的に検証する
 * (Design Principle 5: 捏造禁止・存在しないデータで補完しない、の精神を
 *  API連携部分にも適用する)。
 */
function validateReplayAnalysisShape(parsed) {
  const errors = [];

  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenAI APIの応答がオブジェクトではありません");
  }

  if (!["high", "medium", "low"].includes(parsed.confidence)) {
    errors.push("confidenceが不正です");
  }

  if (!Array.isArray(parsed.strengths) || !parsed.strengths.every((s) => typeof s === "string")) {
    errors.push("strengthsが文字列配列ではありません");
  }

  if (!Array.isArray(parsed.weaknesses) || !parsed.weaknesses.every((w) => typeof w === "string")) {
    errors.push("weaknessesが文字列配列ではありません");
  }

  if (!Array.isArray(parsed.axis)) {
    errors.push("axisが配列ではありません");
  } else if (parsed.axis.length > 3) {
    errors.push("axisが3件を超えています");
  } else {
    const invalidItem = parsed.axis.find(
      (a) =>
        !a ||
        !AXIS_KEYS.includes(a.axis) ||
        typeof a.score !== "number" ||
        a.score < 0 ||
        a.score > 1 ||
        typeof a.reason !== "string"
    );
    if (invalidItem) errors.push("axisの要素の形式が不正です");
  }

  if (errors.length > 0) {
    throw new Error(`OpenAI APIの応答が想定したスキーマと一致しません: ${errors.join(", ")}`);
  }
}
