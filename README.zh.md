# DSH 微信公众号文章下载器

[English](README.md) | 中文

[![npm](https://img.shields.io/npm/v/dsh-wechat-article-fetcher)](https://www.npmjs.com/package/dsh-wechat-article-fetcher)
[![GitHub](https://img.shields.io/badge/GitHub-birdmanhj%2Fdsh--wechat--article--fetcher-181717?logo=github)](https://github.com/birdmanhj/dsh-wechat-article-fetcher)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

输入微信公众号文章 URL，输出完整信息：标题、时间、作者、点赞/在看/阅读、内容（文字/图片/视频/链接）、评论；
支持微信视频号链接（`weixin.qq.com/sph/xxxx`）：标题/作者/封面/点赞/收藏/转发/评论/时间/位置（视频流地址需登录态）。
带反爬能力，可作为 DSH 插件安装，也可作为零依赖 CLI 独立使用。

> 包文档（安装、工具参数、CLI 参数、反爬细节）：[`dsh-wechat-article-fetcher/README.md`](dsh-wechat-article-fetcher/README.md)

## 项目结构

```
DSH-wechat-article-fetcher/
├── dsh-wechat-article-fetcher/   # ✅ 正式插件包（npm 安装名，与目录同名）（可 dsh plugin add 安装、导入其他工程）
│   ├── package.json                 # dsh.bundle.patch -> cordis.patch.yml
│   ├── cordis.patch.yml             # 向 profile 组合插入一个 host 行（id: wechat-article-fetcher）
│   ├── lib/index.js                 # cordis 插件：注册 wechat_article_fetcher 工具
│   ├── lib/fetch_wechat_article.cjs # 零依赖反爬抓取 CLI（核心，Node>=18）
│   └── README.md / README.zh.md / README.i18n.yaml
├── wechat_articles/                 # 默认输出目录（<公众号>/<日期>_<标题>/）
├── probe/                           # 反爬探测样本（可删）
├── test_out/                        # 早期测试输出（可删）
└── HANDOFF.md                       # 全部实测结论与交接记录
```

## 快速开始

### 方式一：DSH 插件（推荐）

```sh
dsh plugin --profile web add dsh-wechat-article-fetcher
```

然后编辑 `~/.dsh/profiles/web/package.json`，把 `dsh-wechat-article-fetcher` 加入
`dsh.profile.bundles` 列表，重启 `dsh web`。之后在任意会话中调用工具
`wechat_article_fetcher`（参数 `url` 必填；`cookie`/`download_images`/`save_files`/`out_dir`/`max_retries` 可选）。

### 方式二：独立 CLI（无需 DSH）

```sh
node dsh-wechat-article-fetcher/lib/fetch_wechat_article.cjs "https://mp.weixin.qq.com/s/xxxx" \
  [--cookie "<微信登录cookie>"] [--no-images] [--out <目录>] [--json] [--max-retries 3]
```

stdout 输出完整 JSON；保存模式落盘 `article.md` / `article.html` / `meta.json` / `images/`。

## 能力与边界（已实测）

| 字段 | 匿名 | 登录 cookie |
|---|---|---|
| 标题/作者/公众号/发布时间/摘要/封面 | ✅ | ✅ |
| 正文（文字·图片·视频·链接结构化块） | ✅ | ✅ |
| 图片下载、专辑/标签 | ✅ | ✅ |
| 阅读数/点赞/在看 | ❌ 微信不暴露 | ✅ |
| 评论（含回复） | ❌ `no session` | ✅ |
| 视频号：标题/作者/封面/计数/时间/位置 | ✅ | ✅ |
| 视频号：视频流地址（mp4） | ❌ 需登录态 | ✅ |

- ❌ 是微信平台限制（`getappmsgext`/`appmsg_comment` 匿名被拒），传 `cookie` 参数解锁
  （需文章页登录态 cookie：含 `wxuin=` 与 `key=`；公众号后台 cookie 对这两个接口无效，已实测）。
- 反爬：UA 池轮换、指数退避重试、验证页（环境异常/验证码）检测、图片并发下载带 Referer。
- 已实测：新版文章（标题/昵称/时间/正文/5 图全对）、2020 老文章（17 图/封面/时间全对）、
  删除文章（`article_unavailable` 识别）、Markdown/HTML/meta 落盘与图片相对路径、
  视频解析（mock 验证 vid/播放页提取与混合块顺序）。
- 定位：**以文章内容为主**；点赞/评论为可选增强（登录态 cookie 获取成本高，按需使用）。

## 会话/工作区迁移记录

- 本工作区由 `DSH_wchat_article_downloader` 经 `mv_session` 迁移至当前路径，
  `mv_session verify` 结果 **CONSISTENT**（会话 header cwd、sessions 目录、工作区注册表、
  zstd 帧、投影缓存全部一致）。
- 安装/迁移后需重启一次 `dsh web` 生效；重启后可用 `mv_session { verify: true }` 复检。

## 插件市场检索结论（2026-08，勿重复检索）

市场无现成完整下载器：`dsh-wechat-mp`（Markdown 排版）、`dsh-wechat-mp-studio`（内容生产）、
`dsh-deepread`（阅读分析）均非完整下载器；社区 `wechat-article-fetcher` Skill（Python）
缺点赞/评论/视频。故自研，其反爬思路（移动端 UA、data-src、短链接优先）已借鉴。

## 组合角色（五插件组合定案 2026-08-28）

本插件在组合中只负责**抓取**：URL → 全文/图片/元数据归档（article.md/html/meta.json）。
不搜索（DSH-wechat-article-searcher 管）、不评分（DSH-wechat-article-scorer 管）、
不入库决策（DSH-wechat-articles 管）、不推送（DSH-im-wechat 管）、
不编排（DSH-wechat-article-pipeline 管）。

组合架构总文档：`DSH-wechat-article-pipeline/docs/plugin-composition.md`。
