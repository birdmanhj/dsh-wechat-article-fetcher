# dsh-wechat-article-fetcher

English | [中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-wechat-article-fetcher)](https://www.npmjs.com/package/dsh-wechat-article-fetcher)
[![GitHub](https://img.shields.io/badge/GitHub-birdmanhj%2Fdsh--wechat--article--fetcher-181717?logo=github)](https://github.com/birdmanhj/dsh-wechat-article-fetcher)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) plugin that downloads
**complete WeChat Official Account (公众号) articles** from a URL — title, author, account, publish
time, and the full body as structured text/image/video/link blocks — with built-in anti-bot
protection. Read/like/"wow" stats and comments are available when a WeChat login cookie is
provided.

```
install → in any session say "fetch this article <URL>" → done
```

## What it extracts

| Field | Anonymous | With login cookie |
|---|---|---|
| Title / author / account nickname / gh_id | ✅ | ✅ |
| Publish time (timestamp + display) | ✅ | ✅ |
| Digest / cover / source URL / album & tags | ✅ | ✅ |
| Content blocks — text / image / video / link | ✅ | ✅ |
| Image list (mmbiz URLs, optional download) | ✅ | ✅ |
| Video vid + player page (+ mp4, best-effort) | ✅ | ✅ |
| Read / like / wow counts | ❌ WeChat hides them | ✅ |
| Comments (with replies) | ❌ `no session` | ✅ |

The ❌ rows are WeChat platform restrictions, not plugin limitations: the `getappmsgext` /
`appmsg_comment` APIs reject anonymous access. The login cookie must be the **article-page login
state** (`wxuin` + `key` + `pass_ticket`); an mp-admin cookie (`slave_sid` / `data_ticket`) does
not work for these endpoints (verified in practice).

## WeChat Channels (视频号) support

`https://weixin.qq.com/sph/xxxx` links are auto-detected and resolved via the Channels feed API
(`finder-preview/api/feed/get_feed_info`):

| Field | Anonymous | With login cookie |
|---|---|---|
| Title / description / cover image | ✅ | ✅ |
| Author (nickname, avatar, signature) | ✅ | ✅ |
| Like / fav / forward / comment counts (incl. `万` formatting) | ✅ | ✅ |
| Publish time / location / export id | ✅ | ✅ |
| Video stream URL (h264/h265 mp4) | ❌ `此内容暂时无法播放` | ✅ |

Files are saved into **date-based folders**: `<out_dir>/视频号/<YYYY-MM-DD>_<标题>/`.

## Install

```sh
dsh plugin --profile web add dsh-wechat-article-fetcher
# or from a local checkout:
dsh plugin --profile web add /path/to/dsh-wechat-article-fetcher
```

The CLI forwards to pnpm and does not maintain the bundle list, so add the package name to
`dsh.profile.bundles` in `~/.dsh/profiles/web/package.json`, then restart `dsh web`:

```jsonc
{ "dsh": { "profile": { "bundles": [ "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-wechat-article-fetcher" ] } } }
```

## Usage

In any DSH session, call the `wechat_article_fetcher` tool:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | string | — (required) | Article URL; short link `https://mp.weixin.qq.com/s/xxxx` preferred |
| `cookie` | string | — | WeChat login cookie (article-page state) to unlock stats & comments |
| `download_images` | boolean | `true` | Download article images to disk |
| `save_files` | boolean | `true` | Save `article.md` / `article.html` / `meta.json` / `images/` |
| `out_dir` | string | `<workspace>/wechat_articles` | Output root; files land in `<out_dir>/<公众号>/<日期>_<标题>/` |
| `max_retries` | integer | `3` | Max fetch retries per URL (capped at 5) |

The tool returns structured JSON (`ok`, `title`, `author`, `account`, `publish_time`, `digest`,
`cover_url`, `album`, `tags`, `stats`, `content_text`, `content_blocks`, `images`, `videos`,
`links`, `comments`, `files`, `warnings`) plus a readable summary render.

## Standalone CLI (no DSH needed)

The shipped fetcher works without the harness too:

```sh
node lib/fetch_wechat_article.cjs "<url>" [--cookie "<cookie>"] [--no-images] [--out <dir>] [--json] [--max-retries <n>]
```

Requirements: Node.js >= 18, zero npm dependencies.

## Anti-bot behavior

- UA pool rotation (WeChat mobile / desktop) on every attempt
- exponential backoff retries with jitter (default 3)
- verification-page detection (`环境异常` / captcha) with clear error reporting
- image downloads: concurrency 4 + `Referer: https://mp.weixin.qq.com/`
- short links preferred; deleted/expired articles are reported as `article_unavailable`

## Layout

```
dsh-wechat-article-fetcher/
├── package.json              # dsh.bundle.patch -> cordis.patch.yml
├── cordis.patch.yml          # inserts one host row (id: wechat-article-fetcher)
├── lib/
│   ├── index.js              # cordis plugin: registers the wechat_article_fetcher tool
│   └── fetch_wechat_article.cjs  # zero-dependency anti-bot fetcher CLI
└── README.md / README.zh.md / README.i18n.yaml
```

## Naming

One product, three conventional spellings: **package** `dsh-wechat-article-fetcher` (install
name), **composition row id** `wechat-article-fetcher`, **tool** `wechat_article_fetcher`.

## License

MIT — see [LICENSE](LICENSE).
