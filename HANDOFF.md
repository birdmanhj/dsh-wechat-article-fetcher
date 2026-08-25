# 微信公众号文章下载插件 —— 成果交接文档

> 项目：DSH-wechat-article-fetcher（已由 mv_session 从 DSH_wchat_article_downloader 迁移，verify=CONSISTENT）
> 状态：✅ 动态 Cordis 插件 `wxart-1`（工具 `wechat_article_fetcher`）已运行并端到端实测通过。
> 本文件记录全部已验证结论，供当前会话或任何新会话无缝接手。

## 会话迁移记录（2026-08-25）

- 工作区由 `/Users/huangjian/vibe-workshop/DSH_wchat_article_downloader` 迁移至
  `/Users/huangjian/vibe-workshop/DSH-wechat-article-fetcher`（mv_session 工具）。
- `mv_session verify` 结果：**CONSISTENT**（workspace 记录 f9d216ec、会话 header cwd、
  zstd 帧、sessions 目录名、投影缓存均已一致；空会话 session-48b35bc4 残留条目已清理）。
- ✅ 已完成重启并复检（2026-08-25 晚）：重启后 `mv_session verify` 仍 CONSISTENT（8225 帧），
  会话进程内 cwd 生效为新路径（bash 默认 workdir 正常）；动态插件 wxart-1 随进程重启消失，
  `wechat_article_fetcher` 由正式插件包提供（运行时工具注册表已确认）。

## 插件封装状态（已完成，2026-08-25）

- 动态 Cordis 插件：`wxart-1`（当前 Package `pkg-3`，Host-only，无 Client 审批负担）。
- 工具：`wechat_article_fetcher`，参数 `url`(必填)/`cookie`/`download_images`/`save_files`/`out_dir`/`max_retries`。
- execute：`ctx.get('shell')` → `resolve({command, timeoutMs:240000, stdoutMaxBytes:4MB, signal})`
  → `run(spec)` → 解析 stdout JSON；output.schema `{type:'object', additionalProperties:true}`；
  render 输出摘要+统计+评论+正文截取（4000 字）。
- 校验坑记录：`parameters.additionalProperties` 必须省略或 true；`output.schema.additionalProperties`
  必须显式 true/false（pkg-1/pkg-2 的失败原因）。
- 端到端实测（2026-08-25 20:58）：真实文章 `https://mp.weixin.qq.com/s/3xRnyBRJFhBzhOJAar4USg`
  → 标题/公众号(gh_id)/时间/正文 834 字/5 图全部正确；article.md/article.html/meta.json/images/
  完整落盘（5 图 png/jpeg/gif 下载成功、相对路径正确）；点赞/评论如实标注需登录 cookie。
- 脚本路径常量：`SCRIPT=/Users/huangjian/vibe-workshop/DSH-wechat-article-fetcher/dsh-wechat-article-fetcher/lib/fetch_wechat_article.cjs`、
  `DEFAULT_OUT=/Users/huangjian/vibe-workshop/DSH-wechat-article-fetcher/wechat_articles`（当前工作区专用）。

## 后续（可选）

1. ~~正式插件包~~ ✅ 已完成（2026-08-25）：`dsh-wechat-article-fetcher/`（v0.1.0，照 `dsh-mv-session`
   模板：package.json 声明 `dsh.bundle.patch`，cordis.patch.yml 插入 host 行，lib/index.js 用
   `ctx.tools.register` + `import.meta.url` 包内脚本路径，零运行时 import）。
   已安装：`pnpm add link:...` 进 web profile 依赖 + `dsh.profile.bundles` 已追加，
   `dsh --profile web --dump-config` 验证组合树含该行 ✅。**重启 dsh web 后生效**
   （重启后动态插件 wxart-1 消失、正式工具 wechat_article_fetcher 由包提供）。
2. ~~视频解析~~ ✅ mock 验证通过（本地 mock 服务器：iframe mpvideo vid/player_url 提取、
   best-effort mp4 note、文本/图片/视频/链接混合块顺序、图片尺寸、外链分类全部正确）；
   真实带视频文章的端到端仍可补测（搜索渠道被反爬，未拿到真实带视频 URL）。
3. 登录 cookie 全链路补测：待用户提供微信登录 cookie（只作一次性测试参数，不落盘）。
4. Client 结果卡片（需 Vite 构建管线，列为 v0.2，当前 Host-only 与 dsh-mv-session 一致）。

## 需求

给 DSH 设计一个插件：输入微信公众号文章 URL，输出完整信息——
标题、时间、作者、点赞、内容（文字/图片/视频/链接）、评论。
可被其他工程直接导入复用。

## 市场检索结论（已完成，勿重复检索）

插件市场**没有**现成的满足"完整信息下载"的插件：

| 候选 | 结论 |
|---|---|
| npm `dsh-wechat-mp` | Markdown → 公众号草稿排版工具，非下载器 |
| `FuncWei/dsh-wechat-mp-studio` | 公众号内容生产工作台（写作/配图），非下载器 |
| `xiehuan123/dsh-deepread` | 支持微信文章 URL 输入，但输出是阅读分析（claims/证据），不提取点赞/评论/视频/完整原文 |
| Claude Skill `wechat-article-fetcher`（wwwzhouhui/skills_collection） | Python 脚本抓标题/作者/时间/正文/图片，**无**点赞/评论/视频，且非 DSH 插件（其反爬思路已借鉴） |

结论：按用户要求**自研**。

## 实测验证过的关键结论（微信反爬与数据可得性）

1. `mp.weixin.qq.com/s/xxx` 文章页**匿名可抓**（HTTP 200，约 3MB HTML）；主页/文章页无严格反爬。
   需要：移动端微信 UA + Referer，偶发"环境异常"验证页需重试/换 UA。
2. **可匿名提取**：标题（og:title / `var msg_title`）、发布时间（`var ct` 时间戳 + `createTime` 字符串）、
   正文（`<div id="js_content">`，div 深度平衡切割）、图片（`img data-src`，mmbiz.qpic.cn，
   下载无需 Referer 但带上无害）、链接（`a href`）、公众号名（`var nickname`，新版页面有；
   极新版可能只有 gh_id + biz）、gh_id/biz/mid/idx/sn 参数、专辑/标签（getappmsgext 匿名可拿）。
3. **匿名拿不到**：阅读数/点赞/在看（`like_num=""` 静态为空；`getappmsgext` 匿名只返回专辑信息）、
   评论（`appmsg_comment` 返回 `ret:-3 "no session"`）。
   → 插件设计为**可选 cookie 参数**：提供微信登录 cookie 时拉取 read_num/like_num/old_like_num/
   friend_like_num（在看）与评论分页（appmsg_comment，含昵称/内容/时间/点赞/回复）；
   无 cookie 时如实标注 note（脚本已实现）。
4. 视频：文章内嵌视频形态 `<iframe class="video_iframe" data-src="...action=mpvideo&vid=wxv_...">`；
   脚本提取 vid + 播放页链接，并尝试 `mp/videoplayer?action=get_mp_video_play_url` 解析 mp4（匿名常失败，best-effort + note）。
   （未找到带视频的真实文章做端到端验证——搜狗搜索被 antispider 拦截，此路径待补测。）
5. 删除/过期文章返回 weui-msg 页面 → 脚本识别为 `error: article_unavailable`（已实测）。

## 文件清单

```
dsh-wechat-article-fetcher/   # 正式插件包（npm 安装名；行 id：wechat-article-fetcher；工具：wechat_article_fetcher）
└── lib/fetch_wechat_article.cjs  # 零依赖核心脚本（Node>=18，内置 fetch）
probe/                        # 探测样本（article.html / appmsgext.json / ed7.html 等）
test_out/                     # 保存模式测试输出（可删）
fetch_test_stderr.log         # 测试日志（可删）
```

## 脚本用法与已验证结果

```bash
node dsh-wechat-article-fetcher/lib/fetch_wechat_article.cjs "<url>" [--cookie C] [--no-images] [--out DIR] [--json] [--max-retries N]
```

- stdout 输出完整 JSON：`{ok,url,final_url,fetched_at,title,author,account{nickname,gh_id,biz},
  publish_time{timestamp,display},digest,cover_url,source_url,album,tags,stats{read/like/在看+note},
  content_text,content_blocks[{type:text|image|video|link}],images[],videos[],links[],
  comments{total,items[],note},files{},warnings[],error}`
- 保存模式落盘：`<out>/<公众号>/<日期>_<标题>/{article.md, article.html, meta.json, images/}`
- 反爬：UA 池轮换、指数退避重试、验证页检测、图片并发 4 + Referer。

**已实测**：新版文章（中宁县人民检察院，2026-04-10：标题/昵称/时间/正文/5 图全对）、
2020 老文章（西安交大财务处：17 图、封面、时间全对）、删除文章（article_unavailable 识别）、
图片下载（md/html/meta 落盘正确，图片相对路径 bug 已修）。

## 下一步（插件封装，契约已全部摸清）

1. 动态 Cordis 插件：Host 注册工具 `wechat_article_fetcher`。
   - 参数：`url`(必填)、`cookie`(可选)、`download_images`(默认 true)、`save_files`(默认 true)、`out_dir`(可选)、`max_retries`(默认 3)
   - execute：`ctx.get('shell')` 执行脚本，契约（已从源码确认）：
     `resolve({command, workdir?, timeoutMs?, stdoutMaxBytes?})` → `run(spec)` →
     `{exitCode, stdout:{text,truncated,spillPath}, stderr:{text}}`；
     默认 workdir = `config.cwd` 或 `process.cwd()`（即会话工作区）。
   - 脚本内嵌进 Package：脚本无反引号/`${`，用 `String.raw` 模板字面量内嵌，
     apply 时经 shell heredoc（`cat > f <<'EOF'`）落盘到工作区 `wechat_article_fetcher/`。
   - 工具注册：`harness.defineTool({name, description, parameters, output:{schema, render}, execute})`
     + `harness.registerTool(ctx, tool)`；output.schema 用宽松 `{"type":"object"}`，
     render 渲染摘要+正文+评论文本。
2. 定义（`cordis_define`）→ 运行（`cordis_run`）→ 用真实 URL 端到端验证工具调用结果。
3. 可选 Client 卡片（`tool.call.toolview` key=工具名）美化结果展示。
4. 整理为正式插件包（cordis.yml，可 `dsh plugin add`，跨重启持久）。

## 最终定稿（2026-08-25 晚，用户确认）

- ✅ 正式插件包 `wechat-article-fetcher` v0.1.0 已安装进 web profile 并重启验证：
  运行时工具 `wechat_article_fetcher` 已注册、组合树含该行、会话迁移 verify CONSISTENT。
- ✅ 视频解析代码路径 mock 验证通过（iframe mpvideo vid/player_url、best-effort mp4、混合块顺序）。
- ✅ **登录态（点赞/评论）按用户确认关闭为"可选增强、非必须"**：用户浏览器文章页无登录入口，
  后台 cookie（slave_sid/data_ticket）实测对 getappmsgext/appmsg_comment 无效
  （评论接口返回 `cookie_count:0`）；有效登录态需文章页 `wxuin`+`key`+`pass_ticket`，
  获取路径（PC 微信抓包）成本高、用户判定不需要。插件 `cookie` 参数保留，未来若提供
  含 `key=` 的文章页 cookie 即可直接解锁，无需改代码。
- Client 结果卡片列为 v0.2（需 Vite 构建管线），当前 Host-only 与 dsh-mv-session 一致。

## 参考

- 插件开发技能：会话中 `cordis-plugin-development` skill（已加载过一次，核心流程见系统提示）。
- shell 契约源码：`dsh-shell/lib/types/types.d.ts`、`dsh-bash-local/lib/index.js`。
- 工具契约源码：`dsh-tools/lib/types/index.d.ts`（ToolDefinition/ToolSchema/ToolOutputDefinition）、
  `dsh-cordis-host-runner/lib/index.js`（sandboxDefineTool 校验规则）。
