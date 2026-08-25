# wechat-article-fetcher

DeepSeek Harness plugin: complete **WeChat Official Account (公众号) article downloader**.
Input a `mp.weixin.qq.com/s/...` URL, get the full article out — with anti-bot protection.

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

The ❌ rows are WeChat platform restrictions, not plugin limitations: the
`getappmsgext` / `appmsg_comment` APIs reject anonymous access. Pass `cookie`
to unlock them.

## Install

```sh
dsh plugin --profile web add dsh-wechat-article-fetcher
# or from a local checkout:
dsh plugin --profile web add /path/to/dsh-wechat-article-fetcher
```

Then add the package to the `dsh.profile.bundles` list in
`~/.dsh/profiles/web/package.json` (the CLI forwards to pnpm and does not edit
the bundle list), and restart `dsh web`.

```jsonc
{ "dsh": { "profile": { "bundles": [ "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-wechat-article-fetcher" ] } } }
```

## Usage

In a DSH session, call the `wechat_article_fetcher` tool:

- `url` (required) — short link preferred: `https://mp.weixin.qq.com/s/xxxx`
- `cookie` (optional) — WeChat login cookie to unlock stats & comments
- `download_images` (default `true`)
- `save_files` (default `true`) — saves `article.md` / `article.html` / `meta.json` / `images/`
  under `<out_dir>/<公众号>/<日期>_<标题>/`
- `out_dir` (optional) — defaults to `<session workspace>/wechat_articles`
- `max_retries` (default `3`)

The tool returns structured JSON (title, author, account, publish_time, digest,
cover_url, stats, content_text, content_blocks, images, videos, links,
comments, files) plus a readable summary render.

## Standalone CLI (no DSH needed)

The shipped fetcher works without the harness too:

```sh
node lib/fetch_wechat_article.cjs "<url>" [--cookie "<cookie>"] [--no-images] [--out <dir>] [--json] [--max-retries <n>]
```

Requirements: Node.js >= 18, zero npm dependencies.

## Anti-bot behavior

- UA pool rotation (WeChat mobile / desktop) per attempt
- exponential backoff retries with jitter (default 3)
- verification-page detection (`环境异常` / captcha) with clear error reporting
- image downloads: concurrency 4 + `Referer: https://mp.weixin.qq.com/`
- short links preferred; deleted/expired articles are reported as `article_unavailable`

## Layout

```
wechat-article-fetcher/
├── package.json              # dsh.bundle.patch -> cordis.patch.yml
├── cordis.patch.yml          # inserts one host row
├── lib/
│   ├── index.js              # cordis plugin: registers wechat_article_fetcher
│   └── fetch_wechat_article.cjs  # zero-dependency anti-bot fetcher CLI
└── README.md / README.zh.md
```

## License

MIT
