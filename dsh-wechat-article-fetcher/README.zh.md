# dsh-wechat-article-fetcher

[English](README.md) | 中文

[![npm](https://img.shields.io/npm/v/dsh-wechat-article-fetcher)](https://www.npmjs.com/package/dsh-wechat-article-fetcher)
[![GitHub](https://img.shields.io/badge/GitHub-birdmanhj%2Fdsh--wechat--article--fetcher-181717?logo=github)](https://github.com/birdmanhj/dsh-wechat-article-fetcher)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 插件：从 URL 下载**完整的
微信公众号文章**——标题、作者、公众号、发布时间，以及按文字/图片/视频/链接结构化块的完整正文，
内置反爬保护。提供微信登录 cookie 时，还可获取阅读/点赞/在看数据与评论。

```
安装 → 会话里说一句"抓取这篇文章 <URL>" → 完成
```

## 可提取字段

| 字段 | 匿名访问 | 提供登录 cookie |
|---|---|---|
| 标题 / 作者 / 公众号名 / gh_id | ✅ | ✅ |
| 发布时间（时间戳 + 显示格式） | ✅ | ✅ |
| 摘要 / 封面 / 原文链接 / 专辑与标签 | ✅ | ✅ |
| 内容块 — 文字 / 图片 / 视频 / 链接 | ✅ | ✅ |
| 图片列表（mmbiz 地址，可下载） | ✅ | ✅ |
| 视频 vid + 播放页（mp4 尽力解析） | ✅ | ✅ |
| 阅读数 / 点赞 / 在看 | ❌ 微信不暴露 | ✅ |
| 评论（含回复） | ❌ `no session` | ✅ |

❌ 行是微信平台限制（`getappmsgext` / `appmsg_comment` 接口拒绝匿名访问），并非插件缺陷。
登录 cookie 必须是**文章页登录态**（`wxuin` + `key` + `pass_ticket`）；公众号后台 cookie
（`slave_sid` / `data_ticket`）对这两个接口无效（已实测验证）。

## 微信视频号支持

`https://weixin.qq.com/sph/xxxx` 链接自动识别，经视频号接口
（`finder-preview/api/feed/get_feed_info`）解析：

| 字段 | 匿名访问 | 提供登录 cookie |
|---|---|---|
| 标题 / 描述 / 封面图 | ✅ | ✅ |
| 作者（昵称、头像、签名） | ✅ | ✅ |
| 点赞 / 收藏 / 转发 / 评论数（含"万"格式化） | ✅ | ✅ |
| 发布时间 / 位置 / export id | ✅ | ✅ |
| 视频流地址（h264/h265 mp4） | ❌ `此内容暂时无法播放` | ✅ |

文件保存为**按日期目录**：`<out_dir>/视频号/<YYYY-MM-DD>_<标题>/`。

## 安装

```sh
dsh plugin --profile web add dsh-wechat-article-fetcher
# 或从本地目录安装：
dsh plugin --profile web add /path/to/dsh-wechat-article-fetcher
```

CLI 只转发 pnpm、不维护 bundles 列表，因此还需把包名加入
`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`，然后重启 `dsh web`：

```jsonc
{ "dsh": { "profile": { "bundles": [ "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-wechat-article-fetcher" ] } } }
```

## 用法

在任意 DSH 会话中调用工具 `wechat_article_fetcher`：

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `url` | string | —（必填） | 文章链接；优先短链接 `https://mp.weixin.qq.com/s/xxxx` |
| `cookie` | string | — | 微信登录 cookie（文章页登录态），解锁统计与评论 |
| `download_images` | boolean | `true` | 是否下载文章图片到磁盘 |
| `save_files` | boolean | `true` | 保存 `article.md` / `article.html` / `meta.json` / `images/` |
| `out_dir` | string | `<工作区>/wechat_articles` | 输出根目录；文件落盘 `<out_dir>/<公众号>/<日期>_<标题>/` |
| `max_retries` | integer | `3` | 单 URL 最大重试次数（上限 5） |

工具返回结构化 JSON（`ok`、`title`、`author`、`account`、`publish_time`、`digest`、`cover_url`、
`album`、`tags`、`stats`、`content_text`、`content_blocks`、`images`、`videos`、`links`、
`comments`、`files`、`warnings`）以及可读摘要。

## 独立 CLI（无需 DSH）

内置抓取脚本可脱离 DSH 单独使用：

```sh
node lib/fetch_wechat_article.cjs "<url>" [--cookie "<cookie>"] [--no-images] [--out <dir>] [--json] [--max-retries <n>]
```

要求：Node.js >= 18，零 npm 依赖。

## 反爬行为

- 每次尝试轮换 UA（微信移动端 / 桌面端）
- 指数退避重试 + 抖动（默认 3 次）
- 验证页检测（`环境异常` / 验证码）并明确报错
- 图片下载：并发 4 + `Referer: https://mp.weixin.qq.com/`
- 优先短链接；已删除/过期文章返回 `article_unavailable`

## 目录结构

```
dsh-wechat-article-fetcher/
├── package.json              # dsh.bundle.patch -> cordis.patch.yml
├── cordis.patch.yml          # 插入一个 host 行（id: wechat-article-fetcher）
├── lib/
│   ├── index.js              # cordis 插件：注册 wechat_article_fetcher 工具
│   └── fetch_wechat_article.cjs  # 零依赖反爬抓取 CLI
└── README.md / README.zh.md / README.i18n.yaml
```

## 命名

一个产品、三种规范写法：**包名（安装名）** `dsh-wechat-article-fetcher`、**组合行 id**
`wechat-article-fetcher`、**工具名** `wechat_article_fetcher`。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
