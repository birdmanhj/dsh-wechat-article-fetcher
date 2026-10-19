# DSH WeChat Article Fetcher

English | [中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-wechat-article-fetcher)](https://www.npmjs.com/package/dsh-wechat-article-fetcher)
[![GitHub](https://img.shields.io/badge/GitHub-birdmanhj%2Fdsh--wechat--article--fetcher-181717?logo=github)](https://github.com/birdmanhj/dsh-wechat-article-fetcher)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Input a WeChat Official Account (公众号) article URL, get the complete article out: title, time,
author, read/like/wow stats, content (text / image / video / link blocks), and comments — with
anti-bot protection. WeChat Channels links (`weixin.qq.com/sph/xxxx`) are supported too: title,
author, cover, like/fav/forward/comment counts, time, and location (video stream url needs a login
cookie). Works as a DSH plugin and as a zero-dependency standalone CLI.

> Package docs (install, tool parameters, CLI flags, anti-bot details):
> [`dsh-wechat-article-fetcher/README.md`](dsh-wechat-article-fetcher/README.md)

## Repository layout

```
DSH-wechat-article-fetcher/
├── dsh-wechat-article-fetcher/   # ✅ npm plugin package (dsh plugin add / import into other projects)
│   ├── package.json                 # dsh.bundle.patch -> cordis.patch.yml
│   ├── cordis.patch.yml             # inserts one host row (id: wechat-article-fetcher)
│   ├── lib/index.js                 # cordis plugin: registers the wechat_article_fetcher tool
│   ├── lib/fetch_wechat_article.cjs # zero-dependency anti-bot fetcher CLI (core, Node>=18)
│   └── README.md / README.zh.md / README.i18n.yaml
├── wechat_articles/                 # default output root (<公众号>/<日期>_<标题>/)
├── probe/                           # anti-bot probe samples (deletable)
├── test_out/                        # early test output (deletable)
└── HANDOFF.md                       # all verified findings and handoff notes
```

## Quick start

### Option 1: DSH plugin (recommended)

```sh
dsh plugin --profile web add dsh-wechat-article-fetcher
```

Then add `dsh-wechat-article-fetcher` to the `dsh.profile.bundles` list in
`~/.dsh/profiles/web/package.json` and restart `dsh web`. Afterwards, call the
`wechat_article_fetcher` tool in any session (`url` required;
`cookie`/`download_images`/`save_files`/`out_dir`/`max_retries` optional).

### Option 2: standalone CLI (no DSH)

```sh
node dsh-wechat-article-fetcher/lib/fetch_wechat_article.cjs "https://mp.weixin.qq.com/s/xxxx" \
  [--cookie "<WeChat login cookie>"] [--no-images] [--out <dir>] [--json] [--max-retries 3]
```

stdout prints the full JSON; save mode writes `article.md` / `article.html` / `meta.json` /
`images/`.

## Capabilities & limits (all verified in practice)

| Field | Anonymous | Login cookie |
|---|---|---|
| Title / author / account / publish time / digest / cover | ✅ | ✅ |
| Body (text · image · video · link structured blocks) | ✅ | ✅ |
| Image download, album & tags | ✅ | ✅ |
| Read / like / wow counts | ❌ WeChat hides them | ✅ |
| Comments (with replies) | ❌ `no session` | ✅ |
| Channels: title/author/cover/counts/time/location | ✅ | ✅ |
| Channels: video stream url (mp4) | ❌ login needed | ✅ |

- The ❌ rows are WeChat platform restrictions (`getappmsgext` / `appmsg_comment` reject
  anonymous access). Unlock them with the `cookie` parameter — it must be the article-page
  login state (contains `wxuin=` and `key=`); an mp-admin cookie does not work (verified).
- Anti-bot: UA pool rotation, exponential backoff retries, verification-page
  (`环境异常`/captcha) detection, concurrent image downloads with Referer.
- Verified: modern article (title/nickname/time/body/5 images all correct), 2020 legacy article
  (17 images/cover/time), deleted article (`article_unavailable` detection), markdown/html/meta
  export with correct relative image paths, video parsing (mock-verified vid/player extraction
  and mixed-block ordering).
- Positioning: **article content first**; likes/comments are an optional enhancement (login
  cookie acquisition is costly — opt-in only).

## Session/workspace migration record

- This workspace was migrated from `DSH_wchat_article_downloader` to the current path via
  `mv_session`; `mv_session verify` reports **CONSISTENT** (session header cwd, sessions dir,
  workspace registry, zstd frames, projection cache all aligned).
- After installing/migrating, restart `dsh web` once; afterwards re-check with
  `mv_session { verify: true }`.

## Plugin marketplace survey (2026-08; no need to re-search)

No existing plugin is a complete downloader: `dsh-wechat-mp` (markdown typesetting),
`dsh-wechat-mp-studio` (content production), and `dsh-deepread` (reading analysis) all miss
likes/comments/videos or full original content. The community `wechat-article-fetcher` Skill
(Python) lacks likes/comments/videos. Therefore this plugin was built from scratch, borrowing
its anti-bot ideas (mobile UA, `data-src`, short-link preference).
