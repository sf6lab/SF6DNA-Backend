# SF6 DNA Video API

character.html のおすすめ動画（初心者/中級者/上級者/対戦動画）を、
YouTube Data API v3経由で自動取得するためのバックエンドです。

## できること

- `GET /api/videos/search?q=<検索キーワード>&max=<件数>` で動画を検索
- 同じ検索キーワードへのリクエストは24時間キャッシュを返す（YouTube APIのクォータ節約のため）
- APIキーはサーバー側の環境変数にのみ保持し、フロントエンドには一切渡さない

## ローカルでの動作確認

```bash
npm install
cp .env.example .env
# .env の YOUTUBE_API_KEY に取得したキーを設定
npm start
```

`http://localhost:3000/health` にアクセスして `{"ok":true}` が返れば起動成功です。

## Renderへのデプロイ手順

1. このバックエンドのフォルダを、**フロントエンドとは別の新しいGitHubリポジトリ**にアップロードする
   （同じリポジトリに同居させても動きますが、分けておくとRenderの設定がシンプルになります）
2. [render.com](https://render.com) にGitHubアカウントでサインアップ
3. ダッシュボードで「New +」→「Web Service」
4. 先ほどのリポジトリを選択して連携
5. 設定画面で以下を入力
   - **Name**: 好きな名前（例: `sf6dna-video-api`）
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
6. 「Environment」タブで環境変数を追加
   - `YOUTUBE_API_KEY` : 取得したAPIキー
   - `ALLOWED_ORIGIN` : `https://ユーザー名.github.io`（自分のGitHub PagesのURL）
7. 「Create Web Service」をクリックすると自動でビルド・デプロイが始まります
8. 数分後、`https://sf6dna-video-api.onrender.com` のようなURLが発行されます

このURLが、フロントエンド側（characters.js）から動画を取得する際の接続先になります。

## 無料枠に関する注意

- Renderの無料プランは、しばらくアクセスが無いとサーバーがスリープします。スリープ後の最初のアクセスは起動に10〜30秒程度かかります
- 無料プランのディスクは再デプロイ時にリセットされます。今回のキャッシュ機能はあくまで「毎回検索し直すのを減らすため」のものなので、リセットされても実害はありません（検索し直されるだけです）
- YouTube Data APIは1日10,000ユニットが無料枠です。検索1回あたり約100ユニット消費するため、キャッシュが無い状態だと1日あたり約100回の検索が上限の目安です

## 今後追加する場合（設計メモ）

「よく見られている動画」機能を追加する際は、以下のテーブルを追加する想定です。

```sql
CREATE TABLE video_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  category TEXT,      -- beginner/intermediate/advanced/match/owaren等
  viewed_at INTEGER NOT NULL
);
```

`POST /api/videos/:videoId/view` で記録し、`GET /api/videos/popular?category=beginner` で
直近N日間の再生回数が多い順に返す、という流れになります。
