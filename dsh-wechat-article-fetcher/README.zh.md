# wechat-article-fetcher

DeepSeek Harness 插件：**微信公众号文章完整下载器**。输入 `mp.weixin.qq.com/s/...` 链接，
输出文章完整信息（标题 / 时间 / 作者 / 点赞 / 内容 / 评论），内置反爬策略。

## 可提取字段

| 字段 | 匿名访问 | 提供登录 cookie |
|---|---|---|
| 标题 / 作者 / 公众号名 / gh_id | ✅ | ✅ |
| 发布时间（时间戳 + 显示格式） | ✅ | ✅ |
| 摘要 / 封面 / 原文链接 / 专辑与标签 | ✅ | ✅ |
| 内容块 — 文字 / 图片 / 视频 / 链接 | ✅ | ✅ |
| 图片列表（mmbiz 地址，可下载） | ✅ | ✅ |
| 视频 vid + 播放页（mp4 尽力解析） | ✅ | ✅ |
| 阅读数 / 点赞 / 在看 | ❌ 微信隐藏 | ✅ |
| 评论（含回复） | ❌ `no session` | ✅ |

❌ 行是微信平台限制（`getappmsgext` / `appmsg_comment` 接口拒绝匿名访问），
并非插件缺陷——传入 `cookie` 参数即可解锁。

## 安装

```sh
dsh plugin --profile web add dsh-wechat-article-fetcher
# 或从本地目录安装：
dsh plugin --profile web add /path/to/dsh-wechat-article-fetcher
```

然后把包名加入 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 列表
（CLI 只转发 pnpm，不维护 bundles 列表），并重启 `dsh web`。

```jsonc
{ "dsh": { "profile": { "bundles": [ "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-wechat-article-fetcher" ] } } }
```

## 用法

在 DSH 会话中调用工具 `wechat_article_fetcher`：

- `url`（必填）— 优先短链接：`https://mp.weixin.qq.com/s/xxxx`
- `cookie`（可选）— 微信登录 cookie，解锁阅读/点赞/在看与评论
- `download_images`（默认 `true`）
- `save_files`（默认 `true`）— 保存 `article.md` / `article.html` / `meta.json` / `images/`
  到 `<out_dir>/<公众号>/<日期>_<标题>/`
- `out_dir`（可选）— 默认 `<会话工作区>/wechat_articles`
- `max_retries`（默认 `3`）

工具返回结构化 JSON（title、author、account、publish_time、digest、cover_url、stats、
content_text、content_blocks、images、videos、links、comments、files）和可读摘要。

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
wechat-article-fetcher/
├── package.json              # dsh.bundle.patch -> cordis.patch.yml
├── cordis.patch.yml          # 插入一个 host 行
├── lib/
│   ├── index.js              # cordis 插件：注册 wechat_article_fetch 工具
│   └── fetch_wechat_article.cjs  # 零依赖反爬抓取 CLI
└── README.md / README.zh.md
```

## 许可证

MIT
