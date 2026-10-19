// dsh-wechat-article-fetcher — complete WeChat Official Account article downloader.
//
// Registers one host-side tool, `wechat_article_fetcher`, which runs the shipped
// zero-dependency fetcher CLI (lib/fetch_wechat_article.cjs) through the shell
// service. Input is an mp.weixin.qq.com article URL; output is structured JSON
// with title / author / account / publish time / digest / cover / content blocks
// (text, image, video, link) / image & video & link lists / read-like-wow stats
// and comments (both need a WeChat login cookie — WeChat does not expose them
// anonymously). Anti-bot: UA pool rotation, exponential backoff retries,
// verification-page detection. Optionally downloads images and saves
// markdown/html/meta files to disk.
//
// Deliberately ZERO runtime imports (only the node:url builtin): external
// imports break resolution when this package is installed as a pnpm `link:`
// dependency (Node ESM resolves symlinked packages by their real path).
import { fileURLToPath } from 'node:url';

const name = 'wechat-article-fetcher';
const inject = ['shell', 'tools'];
const SCRIPT = fileURLToPath(new URL('./fetch_wechat_article.cjs', import.meta.url));

const q = (v) => JSON.stringify(String(v));

function render(args, value) {
  if (!value || value.ok === false) {
    const err = (value && value.error) || 'unknown error';
    const warns = value && value.warnings && value.warnings.length ? '\n警告: ' + value.warnings.join('; ') : '';
    const lines = ['❌ 微信抓取失败: ' + err + warns];
    if (value && value.stderr) lines.push('stderr: ' + value.stderr.slice(0, 2000));
    return [{ type: 'text', text: lines.join('\n') }];
  }
  if (value.type === 'channels') {
    const L = [];
    const f = value.feed || {};
    L.push('✅ 已获取微信视频号: ' + (f.title || value.sph_id || '(无标题)'));
    const au = value.author || {};
    L.push('作者: ' + (au.nickname || '(未知)') + (au.signature ? ' | 签名: ' + au.signature : ''));
    if (f.create_time_display) L.push('发布时间: ' + f.create_time_display);
    if (f.location) L.push('位置: ' + f.location);
    const bits = [];
    if (f.like_count) bits.push('赞 ' + f.like_count);
    if (f.fav_count) bits.push('收藏 ' + f.fav_count);
    if (f.forward_count) bits.push('转发 ' + f.forward_count);
    if (f.comment_count) bits.push('评论 ' + f.comment_count);
    if (bits.length) L.push('数据: ' + bits.join(' / '));
    if (f.video_url) L.push('视频: ' + f.video_url);
    else L.push('视频流: 需登录 cookie（匿名仅返回元信息）');
    if (f.cover_url) L.push('封面: ' + f.cover_url);
    if (f.description && f.description !== f.title) L.push('描述: ' + f.description.slice(0, 500));
    if (value.files && value.files.markdown) L.push('已保存: ' + value.files.markdown);
    const warns = value.warnings || [];
    if (warns.length) L.push('⚠️ 警告: ' + warns.join('; '));
    return [{ type: 'text', text: L.join('\n') }];
  }
  const L = [];
  L.push('✅ 已获取微信公众号文章: ' + (value.title || '(无标题)'));
  const acct = value.account || {};
  L.push('公众号: ' + (acct.nickname || '(未知)') + (acct.gh_id ? ' (gh: ' + acct.gh_id + ')' : '') +
    (value.author ? ' | 作者: ' + value.author : ''));
  const pt = value.publish_time || {};
  if (pt.display) L.push('发布时间: ' + pt.display);
  if (value.digest) L.push('摘要: ' + value.digest);
  const st = value.stats;
  if (st) {
    const bits = [];
    if (st.read_num !== null && st.read_num !== undefined) bits.push('阅读 ' + st.read_num);
    if (st.like_num !== null && st.like_num !== undefined) bits.push('点赞 ' + st.like_num);
    if (st.friend_like_num !== null && st.friend_like_num !== undefined) bits.push('在看 ' + st.friend_like_num);
    if (bits.length) L.push('数据: ' + bits.join(' / '));
    if (st.note) L.push('数据说明: ' + st.note);
  }
  const nImg = (value.images || []).length;
  const nVid = (value.videos || []).length;
  const nLink = (value.links || []).length;
  L.push('内容: 正文 ' + String((value.content_text || '').length) + ' 字 / 图片 ' + nImg + ' / 视频 ' + nVid + ' / 链接 ' + nLink);
  const cm = value.comments;
  if (cm) {
    const items = cm.items || [];
    if (items.length) {
      L.push('评论: ' + (cm.total !== null && cm.total !== undefined ? cm.total + ' 条' : items.length + ' 条(已取)'));
      for (const c of items.slice(0, 10)) {
        L.push('- ' + c.nickname + ' (' + (c.create_time_display || '') + ', 赞 ' + c.like_num + '): ' + c.content);
        const reps = c.replies || [];
        for (const r of reps.slice(0, 3)) {
          L.push('  ↳ ' + (r.author_reply ? '[作者] ' : '') + r.nickname + ': ' + r.content);
        }
      }
    } else {
      L.push('评论: ' + (cm.note || '无'));
    }
  }
  if (value.videos && value.videos.length) {
    L.push('视频: ' + value.videos.map((v) => (v.mp4_url || v.player_url || v.vid)).join(' | '));
  }
  if (value.files && value.files.markdown) {
    L.push('已保存: ' + value.files.markdown);
  }
  const text = value.content_text || '';
  if (text) {
    L.push('\n--- 正文(截取) ---\n' + text.slice(0, 4000) + (text.length > 4000 ? '\n...(全文 ' + text.length + ' 字，见保存文件)' : ''));
  }
  const warns = value.warnings || [];
  if (warns.length) L.push('\n⚠️ 警告: ' + warns.join('; '));
  return [{ type: 'text', text: L.join('\n') }];
}

function createTool(ctx) {
  return {
    name: 'wechat_article_fetcher',
    description: 'Fetch complete WeChat content from a URL. For Official Account articles (mp.weixin.qq.com/s/xxxx): ' +
      'title, author, account nickname, publish time, digest, cover, full content as structured blocks ' +
      '(text / image / video / link), image list, video list, link list, read/like/wow stats (login cookie needed), ' +
      'and comments (login cookie needed). For WeChat Channels videos (weixin.qq.com/sph/xxxx): title, author, ' +
      'cover, like/fav/forward/comment counts, publish time, location, and the mp4 url (login cookie needed for the ' +
      'video stream; metadata is available anonymously). Anti-bot: UA pool rotation, exponential backoff retries, ' +
      'verification-page detection. Saves files into date-based folders (视频号/<日期>_<标题>/ for channels).',
    timeoutMs: 240000,
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        url: {
          type: 'string',
          description: 'WeChat article URL (https://mp.weixin.qq.com/s/xxxx) or WeChat Channels video link (https://weixin.qq.com/sph/xxxx).',
        },
        cookie: {
          type: 'string',
          description: 'Optional WeChat login cookie string to unlock read/like/wow stats and comments.',
        },
        download_images: {
          type: 'boolean',
          description: 'Download article images to disk (default true).',
          default: true,
        },
        save_files: {
          type: 'boolean',
          description: 'Save article.md / article.html / meta.json / images to out_dir (default true).',
          default: true,
        },
        out_dir: {
          type: 'string',
          description: 'Output directory for saved files. Defaults to the session workspace wechat_articles directory.',
        },
        max_retries: {
          type: 'integer',
          description: 'Max fetch retries per URL (default 3).',
          default: 3,
        },
      },
      required: ['url'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render,
    },
    async execute(args) {
      const argv = ['node', q(SCRIPT)];
      if (args.save_files === false) argv.push('--json');
      if (args.download_images === false) argv.push('--no-images');
      if (args.out_dir) argv.push('--out', q(args.out_dir));
      const retries = args.max_retries === undefined ? 3 : Number(args.max_retries);
      argv.push('--max-retries', String(retries > 0 ? Math.min(retries, 5) : 3));
      if (args.cookie) argv.push('--cookie', q(args.cookie));
      argv.push(q(args.url));
      const spec = ctx.shell.resolve({
        command: argv.join(' '),
        timeoutMs: 240000,
        stdoutMaxBytes: 4 * 1024 * 1024,
      });
      const result = await ctx.shell.run(spec);
      const stdoutText = result.stdout && typeof result.stdout.text === 'string' ? result.stdout.text : '';
      const stderrText = result.stderr && typeof result.stderr.text === 'string' ? result.stderr.text : '';
      let parsed = null;
      try { parsed = JSON.parse(stdoutText); } catch (e) { /* keep raw */ }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (result.stdout && result.stdout.truncated) parsed.stdoutTruncated = true;
        return parsed;
      }
      return {
        ok: false,
        error: 'script output unparseable',
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stderr: stderrText.slice(-2000),
        stdoutTail: stdoutText.slice(-2000),
      };
    },
  };
}

export default {
  name,
  inject,
  apply(ctx) {
    ctx.effect(() => ctx.tools.register(createTool(ctx)));
  },
};
