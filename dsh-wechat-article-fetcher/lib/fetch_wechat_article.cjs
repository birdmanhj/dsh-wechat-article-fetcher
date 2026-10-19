#!/usr/bin/env node
/*
 * fetch_wechat_article.js — zero-dependency WeChat Official Account article fetcher.
 *
 * Input : article URL (https://mp.weixin.qq.com/s/xxxx short link or full link)
 * Output: structured JSON with title / author / account / publish time / digest /
 *         content blocks (text, image, video, link) / stats (read, like, "wow") /
 *         comments (needs login cookie) — best-effort, anti-bot hardened.
 *
 * Usage:
 *   node fetch_wechat_article.js "<url>" [--cookie "<cookie>"] [--no-images]
 *        [--out <dir>] [--json] [--max-retries <n>] [--no-stats] [--no-comments]
 *
 * Requirements: Node.js >= 18 (global fetch). No npm dependencies.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------- CLI parsing

function parseArgs(argv) {
  const opts = {
    urls: [],
    cookie: '',
    downloadImages: true,
    outDir: path.join(process.cwd(), 'wechat_articles'),
    jsonOnly: false,
    maxRetries: 3,
    tryStats: true,
    tryComments: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cookie') opts.cookie = argv[++i] || '';
    else if (a === '--no-images') opts.downloadImages = false;
    else if (a === '--out') opts.outDir = argv[++i] || opts.outDir;
    else if (a === '--json') opts.jsonOnly = true;
    else if (a === '--max-retries') opts.maxRetries = Math.max(1, parseInt(argv[++i] || '3', 10) || 3);
    else if (a === '--no-stats') opts.tryStats = false;
    else if (a === '--no-comments') opts.tryComments = false;
    else if (a.startsWith('--')) { /* unknown flag ignored */ }
    else if (a.trim()) opts.urls.push(a.trim());
  }
  return opts;
}

// ---------------------------------------------------------------- utilities

const UA_POOL = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.42(0x18002a2a) NetType/WIFI Language/zh_CN',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.42(0x28002a2a) NetType/WIFI Language/zh_CN',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

const HEADERS_BASE = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://mp.weixin.qq.com/',
  'Cache-Control': 'no-cache',
};

let uaIndex = Math.floor(Math.random() * UA_POOL.length);

function nextUa() {
  uaIndex = (uaIndex + 1) % UA_POOL.length;
  return UA_POOL[uaIndex];
}

function log(msg) {
  process.stderr.write('[wechat-fetcher] ' + msg + '\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (m, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return m; }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; }
    });
}

function stripTags(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function normalizeUrl(u) {
  if (!u) return '';
  let s = u.trim();
  if (s.startsWith('//')) s = 'https:' + s;
  return decodeEntities(s);
}

function safeFilename(s, maxLen) {
  const name = String(s || 'untitled')
    .replace(/[\\/:*?"<>|\r\n\t#]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen || 80) || 'untitled';
  return name;
}

function fmtTime(tsSeconds) {
  const t = Number(tsSeconds);
  if (!t || !isFinite(t)) return '';
  const d = new Date(t * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes());
}

// fetch with retries / UA rotation / anti-bot detection.
async function fetchText(url, opts, headersExtra) {
  const maxRetries = (opts && opts.maxRetries) || 3;
  let lastErr = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const headers = Object.assign({}, HEADERS_BASE, {
      'User-Agent': nextUa(),
    });
    if (headersExtra) Object.assign(headers, headersExtra);
    if (opts && opts.cookie) headers['Cookie'] = opts.cookie;
    try {
      const resp = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      const text = await resp.text();
      if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
        lastErr = new Error('HTTP ' + resp.status);
        await sleep(1200 * (attempt + 1) + Math.random() * 800);
        continue;
      }
      if (resp.status >= 400) {
        lastErr = new Error('HTTP ' + resp.status + ' for ' + url);
        if (attempt < maxRetries - 1) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw lastErr;
      }
      return { text, finalUrl: resp.url, status: resp.status };
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries - 1) {
        await sleep(1000 * (attempt + 1) + Math.random() * 500);
      }
    }
  }
  throw lastErr || new Error('fetch failed: ' + url);
}

function looksLikeVerification(html) {
  if (!html) return false;
  if (html.indexOf('wappoc_appmsgcaptcha') >= 0 || html.indexOf('appmsg_captcha') >= 0) return true;
  if (html.indexOf('环境异常') >= 0 && html.indexOf('完成验证') >= 0) return true;
  if (html.indexOf('安全验证') >= 0 && html.indexOf('访问') >= 0) return true;
  if (html.indexOf('verify_scene') >= 0 && html.indexOf('js_content') < 0) return true;
  return false;
}

// ---------------------------------------------------------------- HTML parsing

function extractJsContent(html) {
  // Locate <div id="js_content" ...> and balance div tags until close.
  const startRe = /<div[^>]*id="js_content"[^>]*>/i;
  const m = html.match(startRe);
  if (!m || m.index === undefined) return '';
  let idx = m.index + m[0].length;
  let depth = 1;
  const tagRe = /<(\/?)(div)\b[^>]*>/gi;
  tagRe.lastIndex = idx;
  let match;
  while ((match = tagRe.exec(html)) !== null) {
    if (match[1] === '/') {
      depth -= 1;
      if (depth === 0) {
        return html.slice(idx, match.index);
      }
    } else {
      depth += 1;
    }
  }
  // Fallback: stop at the first known trailer marker.
  const trailers = ['<div class="rich_media_tool"', '<div id="js_tags_preview_toast"', '<!--headV2', '<script'];
  let end = html.length;
  for (const t of trailers) {
    const p = html.indexOf(t, idx);
    if (p >= 0 && p < end) end = p;
  }
  return html.slice(idx, end);
}

function pickMeta(html) {
  const meta = {};
  const grab = (prop, key) => {
    if (meta[key]) return;
    const re = new RegExp('<meta[^>]*property=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
    const m = html.match(re);
    if (m) meta[key] = decodeEntities(m[1]);
  };
  grab('og:title', 'title');
  grab('og:article:author', 'author');
  grab('og:description', 'digest');
  grab('og:url', 'url');
  grab('og:image', 'cover_url');

  const sv = (name) => {
    const re = new RegExp('(?:var\\s+|window\\.)' + name + '\\s*=\\s*["\']([^"\']*)["\']');
    const m = html.match(re);
    if (m) return decodeEntities(m[1]);
    return '';
  };
  // svPlain only for identifier-ish values (digits, base64, hex): excludes '=', '.', '('
  // so JS comparisons like `window.author = data.author` can never pollute a field.
  const svPlain = (name) => {
    const re = new RegExp('(?:var\\s+|window\\.)' + name + '\\s*=\\s*([0-9A-Za-z_\\-]+)');
    const m = html.match(re);
    return m ? decodeEntities(m[1]) : '';
  };

  if (!meta.title) meta.title = sv('msg_title');
  // author / nickname accept quoted forms only; empty or missing means "none".
  const quotedAuthor = sv('msg_author') || sv('author');
  if (!meta.author && quotedAuthor) meta.author = quotedAuthor;
  if (!meta.digest) meta.digest = sv('msg_desc');
  if (!meta.cover_url) meta.cover_url = sv('msg_cdn_url');

  const quotedNickname = sv('nickname');
  if (quotedNickname && quotedNickname.length <= 60) meta.nickname = quotedNickname;
  meta.gh_id = sv('user_name') || svPlain('user_name');
  meta.biz = sv('__biz') || svPlain('__biz') || sv('biz') || svPlain('biz');
  meta.mid = sv('mid') || svPlain('mid');
  meta.idx = sv('idx') || svPlain('idx') || '1';
  meta.sn = sv('sn') || svPlain('sn');
  meta.create_time = sv('ct') || svPlain('ct') || sv('oriCreateTime') || svPlain('oriCreateTime');
  meta.source_url = sv('msg_source_url') || svPlain('msg_source_url');

  // Display time string like "2026-04-10 16:01"
  const dt = html.match(/createTime\s*=\s*['"]([^'"]+)['"]/);
  if (dt) meta.create_time_display = dt[1];

  // Nickname fallback: profile link text inside js_name anchor.
  if (!meta.nickname) {
    const nm = html.match(/<a[^>]*id="js_name"[^>]*>([\s\S]*?)<\/a>/i);
    if (nm) {
      const t = stripTags(nm[1]);
      if (t && t.length < 60) meta.nickname = t;
    }
  }
  if (!meta.nickname) {
    const nm = html.match(/profile_nickname[^>]*>([\s\S]*?)<\//i);
    if (nm) {
      const t = stripTags(nm[1]);
      if (t && t.length < 60) meta.nickname = t;
    }
  }

  // Album title as last-resort nickname hint (flagged).
  if (!meta.nickname) {
    const al = html.match(/album_info\s*=\s*\[[\s\S]{0,2000}?title\s*:\s*['"]([^'"]+)['"]/i) ||
      html.match(/title\s*:\s*['"]([^'"]+)['"],[\s\S]{0,300}?album_id/i);
    if (al) meta.nickname_hint = decodeEntities(al[1]);
  }

  return meta;
}

function isBlockTag(name) {
  return ['p', 'div', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'table', 'tr', 'br', 'hr'].indexOf(name) >= 0;
}

// Tokenize article body into structured blocks.
function tokenizeContent(bodyHtml) {
  const blocks = [];
  const tagRe = /<(\/?)([a-zA-Z0-9]+)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;
  let last = 0;
  let textBuf = '';
  let match;
  const flushText = () => {
    const t = decodeEntities(textBuf.replace(/\s+/g, ' ')).trim();
    if (t) blocks.push({ type: 'text', text: t });
    textBuf = '';
  };
  while ((match = tagRe.exec(bodyHtml)) !== null) {
    const before = bodyHtml.slice(last, match.index);
    if (before) textBuf += before;
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrsStr = match[3] || '';
    const selfClosing = match[4] === '/' || tag === 'br' || tag === 'hr' || tag === 'img' || tag === 'input';
    const attr = (name) => {
      const re = new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', 'i');
      const m = attrsStr.match(re);
      return m ? decodeEntities(m[1]) : '';
    };

    if (tag === 'img' || (tag === 'source')) {
      if (tag === 'img') {
        const src = attr('data-src') || attr('src') || attr('data-original');
        if (src && src.indexOf('data:') !== 0 && src.indexOf('we-emoji') < 0) {
          flushText();
          blocks.push({
            type: 'image',
            url: normalizeUrl(src),
            format: attr('data-type') || '',
            width: attr('data-w') || '',
            height: attr('data-h') || '',
          });
        }
      }
    } else if (tag === 'iframe') {
      const src = attr('data-src') || attr('src');
      const vidMatch = src.match(/vid=([a-zA-Z0-9_\-]+)/);
      if (vidMatch) {
        flushText();
        blocks.push({ type: 'video', vid: vidMatch[1], playerUrl: normalizeUrl(src) });
      }
    } else if (tag === 'video') {
      const src = attr('src') || attr('data-src');
      if (src) {
        flushText();
        blocks.push({ type: 'video', vid: '', playerUrl: normalizeUrl(src), directSrc: normalizeUrl(src) });
      }
    } else if (tag === 'a') {
      if (!closing) {
        flushText();
      }
    } else if (isBlockTag(tag) && !closing) {
      flushText();
      textBuf += '\n';
    } else if (tag === 'br' || tag === 'hr') {
      textBuf += '\n';
    }
    if (selfClosing) {
      // no close tag
    }
    last = tagRe.lastIndex;
  }
  if (last < bodyHtml.length) textBuf += bodyHtml.slice(last);
  flushText();
  return blocks;
}

function extractLinks(bodyHtml) {
  const links = [];
  const seen = new Set();
  const re = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(bodyHtml)) !== null) {
    let href = normalizeUrl(m[1]);
    if (!href || href.startsWith('javascript') || href.startsWith('#')) continue;
    if (href.indexOf('weixin://') === 0 || href.indexOf('wechat://') === 0) continue;
    const text = stripTags(m[2]);
    if (seen.has(href)) continue;
    seen.add(href);
    const isExternal = href.indexOf('mp.weixin.qq.com') < 0 && href.indexOf('weixin.qq.com') < 0;
    links.push({ href, text: text || href, isExternal });
  }
  return links;
}

function extractImages(bodyHtml) {
  const images = [];
  const seen = new Set();
  const re = /<img[^>]*>/gi;
  let m;
  while ((m = re.exec(bodyHtml)) !== null) {
    const tag = m[0];
    const attr = (name) => {
      const r = new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', 'i');
      const mm = tag.match(r);
      return mm ? decodeEntities(mm[1]) : '';
    };
    let src = attr('data-src') || attr('src') || attr('data-original');
    if (!src || src.indexOf('data:') === 0) continue;
    src = normalizeUrl(src);
    if (!src || seen.has(src)) continue;
    if (src.indexOf('mmbiz.qpic.cn') < 0 && src.indexOf('mmbiz.qlogo.cn') < 0) continue;
    seen.add(src);
    images.push({
      url: src,
      format: attr('data-type') || guessFormat(src),
      width: attr('data-w') || '',
      height: attr('data-h') || '',
    });
  }
  return images;
}

function guessFormat(url) {
  const u = url.split('?')[0].toLowerCase();
  if (u.indexOf('wx_fmt=png') >= 0) return 'png';
  if (u.indexOf('.png') >= 0) return 'png';
  if (u.indexOf('.gif') >= 0) return 'gif';
  if (u.indexOf('.webp') >= 0) return 'webp';
  if (u.indexOf('.svg') >= 0) return 'svg';
  if (u.indexOf('.bmp') >= 0) return 'bmp';
  return 'jpeg';
}

// ---------------------------------------------------------------- WeChat Channels (视频号)

function isChannelsUrl(url) {
  return /weixin\.qq\.com\/sph\//.test(url) ||
    /channels\.weixin\.qq\.com/.test(url) ||
    /\/sph\//.test(url);
}

function channelsIdFromUrl(url) {
  let m = url.match(/sph\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/exportId=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return '';
}

function pickFirst(obj, keys, dflt) {
  if (!obj || typeof obj !== 'object') return dflt;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return dflt;
}

// Parse WeChat formatted counts like '1369', '1.4万', '2.3亿' to numbers.
function parseCountFmt(v) {
  if (v === undefined || v === null) return 0;
  const s = String(v).trim();
  const m = s.match(/^([0-9.]+)(万|亿)?$/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (m[2] === '万') n *= 10000;
  if (m[2] === '亿') n *= 100000000;
  return Math.round(n);
}

// Fetch one WeChat Channels (视频号) feed by its sph link.
async function fetchChannelsFeed(url, opts) {
  const out = {
    ok: false,
    type: 'channels',
    url: url,
    final_url: '',
    fetched_at: new Date().toISOString(),
    sph_id: '',
    feed: {},
    author: {},
    files: {},
    warnings: [],
    error: '',
  };
  const id = channelsIdFromUrl(url);
  if (!id) {
    out.error = 'invalid_channels_url';
    out.warnings.push('unable to extract sph id from URL: ' + url);
    return out;
  }
  out.sph_id = id;
  const api = 'https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info';
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': nextUa(),
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://channels.weixin.qq.com/finder-preview/pages/sph?id=' + id,
    'Origin': 'https://channels.weixin.qq.com',
  };
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  let data = null;
  let status = 0;
  try {
    const resp = await fetch(api, {
      method: 'POST',
      headers,
      body: JSON.stringify({ baseReq: { generalToken: '' }, shortUri: id }),
      signal: AbortSignal.timeout(20000),
    });
    status = resp.status;
    out.final_url = resp.url;
    data = await resp.json().catch(() => null);
  } catch (e) {
    out.error = 'channels_fetch_failed: ' + (e && e.message ? e.message : String(e));
    return out;
  }
  if (!data) {
    out.error = 'channels_api_no_json (HTTP ' + status + ')';
    return out;
  }
  if (status === 401 || data.errCode === -1 || (data.errMsg && /permission|verification/i.test(data.errMsg))) {
    out.error = 'sph_requires_login';
    out.warnings.push('WeChat Channels feed API rejects anonymous access ("permission verification failed"). ' +
      'Provide a WeChat login cookie (wxuin + key + pass_ticket) via --cookie to unlock.');
    return out;
  }
  const d = data.data || data;
  const fi = d.feedInfo || {};
  const ai = d.authorInfo || {};
  const scene = d.sceneInfo || {};

  const exportId = pickFirst(scene, ['dynamicExportId', 'exportId'], '');
  const coverUrl = pickFirst(fi, ['coverUrl'], '') ||
    (Array.isArray(fi.picInfo) && fi.picInfo.length ? fi.picInfo[0].picUrl || '' : '');

  const likeFmt = pickFirst(fi, ['likeCountFmt', 'likeCount', 'like_count'], '');
  const favFmt = pickFirst(fi, ['favCountFmt', 'favCount', 'fav_count'], '');
  const fwdFmt = pickFirst(fi, ['forwardCountFmt', 'forwardCount', 'forward_count'], '');
  const cmtFmt = pickFirst(fi, ['commentCountFmt', 'commentCount', 'comment_count'], '');
  const readFmt = pickFirst(fi, ['readCountFmt', 'readCount', 'read_count'], '');

  out.feed = {
    title: pickFirst(fi, ['description', 'title', 'objectDesc'], ''),
    description: pickFirst(fi, ['description', 'title', 'objectDesc'], ''),
    media_type: Number(pickFirst(fi, ['mediaType'], 0)) || 0,
    video_url: '',
    video_h264_url: '',
    video_h265_url: '',
    cover_url: coverUrl,
    images: [],
    duration_sec: 0,
    width: 0,
    height: 0,
    like_count: parseCountFmt(likeFmt),
    fav_count: parseCountFmt(favFmt),
    forward_count: parseCountFmt(fwdFmt),
    comment_count: parseCountFmt(cmtFmt),
    read_count: parseCountFmt(readFmt),
    like_count_fmt: String(likeFmt),
    fav_count_fmt: String(favFmt),
    forward_count_fmt: String(fwdFmt),
    comment_count_fmt: String(cmtFmt),
    read_count_fmt: String(readFmt),
    create_time: Number(pickFirst(fi, ['createtime', 'createTime', 'create_time'], 0)) || 0,
    create_time_display: fmtTime(pickFirst(fi, ['createtime', 'createTime', 'create_time'], 0)),
    location: pickFirst(fi.jumpInfo || {}, ['wording', 'location'], ''),
    export_id: exportId,
  };
  out.author = {
    nickname: pickFirst(ai, ['nickname', 'nickName'], ''),
    username: pickFirst(ai, ['exportUsername', 'finderUsername', 'username'], ''),
    avatar_url: pickFirst(ai, ['authIconUrl', 'headImgUrl', 'avatar'], ''),
    signature: pickFirst(ai, ['signature'], ''),
  };

  // Second step (best-effort): full feed via exportId unlocks the video URL.
  // Anonymous access usually gets "此内容暂时无法播放" — the mp4 needs a login cookie.
  if (exportId) {
    try {
      const resp2 = await fetch(api, {
        method: 'POST',
        headers: Object.assign({}, headers, { 'Referer': 'https://channels.weixin.qq.com/finder-preview/pages/feed?exportId=' + encodeURIComponent(exportId) }),
        body: JSON.stringify({ baseReq: { generalToken: '' }, exportId: exportId }),
        signal: AbortSignal.timeout(20000),
      });
      const d2 = await resp2.json().catch(() => null);
      const fi2 = d2 && d2.data && d2.data.feedInfo;
      if (fi2) {
        const media2 = fi2.media || {};
        const h264 = fi2.h264VideoInfo || {};
        const h265 = fi2.h265VideoInfo || {};
        const vu = pickFirst(media2, ['videoUrl', 'url'], '') ||
          pickFirst(h264, ['videoUrl', 'url'], '') ||
          pickFirst(h265, ['videoUrl', 'url'], '');
        if (vu) {
          out.feed.video_url = vu;
          out.feed.video_h264_url = pickFirst(h264, ['videoUrl', 'url'], '');
          out.feed.video_h265_url = pickFirst(h265, ['videoUrl', 'url'], '');
          out.feed.duration_sec = Number(pickFirst(media2, ['duration', 'videoPlayLen'], 0)) || 0;
          out.feed.width = Number(pickFirst(media2, ['width'], 0)) || 0;
          out.feed.height = Number(pickFirst(media2, ['height'], 0)) || 0;
          const pic2 = Array.isArray(fi2.picInfo) ? fi2.picInfo : [];
          out.feed.images = pic2.map((p) => ({ url: p.picUrl || '', width: p.width || 0, height: p.height || 0 }));
        } else {
          out.warnings.push('video stream url not returned (anonymous access); provide a login cookie to unlock the mp4 url');
        }
      }
    } catch (e) {
      out.warnings.push('exportId feed lookup failed: ' + (e && e.message ? e.message : String(e)));
    }
  }

  if (!out.feed.title && !out.feed.cover_url) {
    out.warnings.push('feed data returned but title/cover fields are empty; response shape may have changed');
  }
  out.ok = true;
  return out;
}

// Save channels result under <out>/视频号/<YYYY-MM-DD>_<title-or-id>/
async function saveChannelsFiles(info, opts) {
  const datePart = info.fetched_at.slice(0, 10);
  const label = info.feed.title
    ? safeFilename(info.feed.title, 60)
    : info.sph_id;
  const base = path.join(opts.outDir, '视频号', datePart + '_' + label);
  const imagesDir = path.join(base, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  const urls = [];
  if (info.feed.cover_url) urls.push(info.feed.cover_url);
  for (const p of info.feed.images || []) {
    if (p.url && urls.length < 5) urls.push(p.url);
  }
  let downloads = [];
  if (opts.downloadImages && urls.length) {
    const imgs = urls.map((u, i) => ({ url: u, format: guessFormat(u), width: '', height: '' }));
    const raw = await downloadImages(imgs, imagesDir, opts);
    downloads = raw.map((r) => ({ index: r.index, file: r.file ? 'images/' + r.file : null, url: r.url, bytes: r.bytes, error: r.error || '' }));
  }

  const metaCopy = JSON.parse(JSON.stringify(info));
  fs.writeFileSync(path.join(base, 'meta.json'), JSON.stringify(metaCopy, null, 2), 'utf8');
  const mdLines = [];
  mdLines.push('# ' + (info.feed.title || info.sph_id));
  mdLines.push('');
  const meta = [];
  if (info.author.nickname) meta.push('视频号: ' + info.author.nickname);
  if (info.feed.create_time_display) meta.push('发布: ' + info.feed.create_time_display);
  if (info.feed.like_count) meta.push('赞 ' + info.feed.like_count);
  if (info.feed.comment_count) meta.push('评论 ' + info.feed.comment_count);
  if (info.feed.forward_count) meta.push('转发 ' + info.feed.forward_count);
  if (meta.length) { mdLines.push('> ' + meta.join('　|　')); mdLines.push(''); }
  if (info.feed.description) { mdLines.push(info.feed.description); mdLines.push(''); }
  if (info.feed.video_url) { mdLines.push('视频: ' + info.feed.video_url); mdLines.push(''); }
  if (info.feed.cover_url) { mdLines.push('![' + (info.feed.title || 'cover') + '](' + (downloads[0] && downloads[0].file ? downloads[0].file : info.feed.cover_url) + ')'); mdLines.push(''); }
  fs.writeFileSync(path.join(base, 'article.md'), mdLines.join('\n'), 'utf8');
  info.files = {
    dir: base,
    markdown: path.join(base, 'article.md'),
    meta: path.join(base, 'meta.json'),
    images_dir: imagesDir,
    images_downloaded: downloads.filter((r) => r.file).length,
  };
  info.image_downloads = downloads;
  return info;
}

// ---------------------------------------------------------------- stats & comments (best-effort)

function deepFind(obj, keys, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const v of obj) deepFind(v, keys, out);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k) && (typeof v === 'number' || typeof v === 'string') && !(k in out)) {
      out[k] = v;
    }
    if (typeof v === 'object') deepFind(v, keys, out);
  }
}

async function fetchStats(meta, opts) {
  const result = {
    read_num: null, like_num: null, old_like_num: null, friend_like_num: null,
    vote_count: null, reward_count: null,
    note: '',
    album: null, tags: [],
  };
  if (!opts.tryStats) return result;
  if (!meta.biz || !meta.mid || !meta.sn) {
    result.note = 'no biz/mid/sn params to query stats';
    return result;
  }
  const q = new URLSearchParams({
    __biz: meta.biz, mid: meta.mid, idx: meta.idx || '1', sn: meta.sn,
    is_only_read: '1', is_temp_url: '0', appmsg_type: '9',
  });
  const url = 'https://mp.weixin.qq.com/mp/getappmsgext?' + q.toString();
  try {
    const { text } = await fetchText(url, opts, { 'Referer': 'https://mp.weixin.qq.com/' });
    const data = JSON.parse(text);
    const found = {};
    deepFind(data, ['read_num', 'like_num', 'old_like_num', 'friend_like_num', 'friend_like_cnt', 'vote_count', 'reward_count'], found);
    if (found.friend_like_cnt !== undefined && found.friend_like_num === undefined) found.friend_like_num = found.friend_like_cnt;
    if (found.read_num !== undefined) result.read_num = Number(found.read_num) || 0;
    if (found.like_num !== undefined) result.like_num = Number(found.like_num) || 0;
    if (found.old_like_num !== undefined) result.old_like_num = Number(found.old_like_num) || 0;
    if (found.friend_like_num !== undefined) result.friend_like_num = Number(found.friend_like_num) || 0;
    if (found.vote_count !== undefined) result.vote_count = Number(found.vote_count) || 0;
    if (found.reward_count !== undefined) result.reward_count = Number(found.reward_count) || 0;
    // album / tags
    const tags = data && data.public_tag_info && data.public_tag_info.tags;
    if (Array.isArray(tags) && tags.length) {
      result.album = tags[0].album_info || null;
      result.tags = tags.map((t) => ({
        name: (t.tag_name) || (t.album_info && t.album_info.title) || '',
        link: t.tag_link || '',
        article_count: t.tag_content_num || 0,
      }));
    }
    if (result.read_num === null && result.like_num === null && !opts.cookie) {
      result.note = 'anonymous access: read/like counts not exposed by WeChat; provide a login cookie (--cookie) to retrieve them';
    } else if (result.read_num === null && result.like_num === null) {
      result.note = 'stats not returned (session may be expired)';
    }
  } catch (e) {
    result.note = 'stats fetch failed: ' + (e && e.message ? e.message : String(e));
  }
  return result;
}

async function fetchComments(meta, opts) {
  const result = { total: null, friendly_total: null, items: [], note: '' };
  if (!opts.tryComments) {
    result.note = 'comments disabled (--no-comments)';
    return result;
  }
  if (!meta.biz || !meta.mid) {
    result.note = 'no biz/mid params to query comments';
    return result;
  }
  const base = 'https://mp.weixin.qq.com/mp/appmsg_comment';
  let offset = 0;
  const limit = 100;
  const seen = new Set();
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({
      action: 'getcomment', scene: '0',
      __biz: meta.biz, appmsgid: meta.mid, idx: meta.idx || '1',
      comment_id: '', offset: String(offset), limit: String(limit), order: '3', f: 'json',
    });
    try {
      const { text } = await fetchText(base + '?' + q.toString(), opts, { 'Referer': 'https://mp.weixin.qq.com/' });
      const data = JSON.parse(text);
      const resp = data.base_resp || {};
      if (Number(resp.ret) !== 0) {
        if (result.items.length === 0) {
          result.note = (resp.errmsg || 'comment api rejected') + ' — comments require a valid WeChat login cookie (--cookie)';
        }
        break;
      }
      if (result.total === null) {
        result.total = data.elected_comment_total_cnt !== undefined ? data.elected_comment_total_cnt : null;
        result.friendly_total = data.friend_comment_total_cnt !== undefined ? data.friend_comment_total_cnt : null;
      }
      const list = data.elected_comment || [];
      if (!list.length) break;
      for (const c of list) {
        const id = String(c.comment_id || c.content_id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const replies = [];
        const rl = c.reply && c.reply.reply_list;
        if (Array.isArray(rl)) {
          for (const r of rl) {
            replies.push({
              nickname: r.nick_name || '',
              content: r.content || '',
              create_time: Number(r.create_time) || 0,
              create_time_display: fmtTime(r.create_time),
              like_num: Number(r.reply_like_num) || 0,
              author_reply: !!r.is_from_author,
            });
          }
        }
        result.items.push({
          comment_id: id,
          nickname: c.nick_name || '',
          content: c.content || '',
          create_time: Number(c.create_time) || 0,
          create_time_display: fmtTime(c.create_time),
          like_num: Number(c.like_num) || 0,
          reply_count: Number(c.reply_cnt) || 0,
          replies,
        });
      }
      offset += list.length;
      if (offset >= (data.elected_comment_total_cnt || 0)) break;
      await sleep(600 + Math.random() * 400);
    } catch (e) {
      if (result.items.length === 0) {
        result.note = 'comment fetch failed: ' + (e && e.message ? e.message : String(e));
      }
      break;
    }
  }
  return result;
}

// ---------------------------------------------------------------- video resolution (best-effort)

async function resolveVideoUrl(vid, meta, opts) {
  if (!vid || !meta.biz || !meta.mid) return null;
  const q = new URLSearchParams({
    action: 'get_mp_video_play_url', __biz: meta.biz, mid: meta.mid,
    idx: meta.idx || '1', vid: vid, f: 'json', scene: '',
  });
  try {
    const { text } = await fetchText('https://mp.weixin.qq.com/mp/videoplayer?' + q.toString(), opts, {});
    const data = JSON.parse(text);
    const urls = data && data.url_info && data.url_info.map((u) => u.url).filter(Boolean);
    if (urls && urls.length) return urls[0];
  } catch (e) { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------- image download

async function downloadImages(images, dir, opts) {
  const results = [];
  const concurrency = 4;
  let idx = 0;
  const worker = async () => {
    while (idx < images.length) {
      const i = idx++;
      const img = images[i];
      const ext = img.format || guessFormat(img.url);
      const name = String(i + 1).padStart(3, '0') + '.' + ext;
      const filePath = path.join(dir, name);
      try {
        const resp = await fetch(img.url, {
          headers: {
            'User-Agent': UA_POOL[2],
            'Referer': 'https://mp.weixin.qq.com/',
          },
          signal: AbortSignal.timeout(25000),
        });
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          fs.writeFileSync(filePath, buf);
          results.push({ index: i + 1, file: name, url: img.url, bytes: buf.length });
        } else {
          results.push({ index: i + 1, file: null, url: img.url, bytes: 0, error: 'HTTP ' + resp.status });
        }
      } catch (e) {
        results.push({ index: i + 1, file: null, url: img.url, bytes: 0, error: e && e.message ? e.message : String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ---------------------------------------------------------------- markdown builder

function buildMarkdown(info) {
  const L = [];
  L.push('# ' + info.title);
  L.push('');
  const meta = [];
  if (info.account && info.account.nickname) meta.push('公众号: ' + info.account.nickname);
  if (info.author) meta.push('作者: ' + info.author);
  if (info.publish_time && info.publish_time.display) meta.push('发布时间: ' + info.publish_time.display);
  if (info.stats && info.stats.read_num !== null) meta.push('阅读: ' + info.stats.read_num);
  if (info.stats && info.stats.like_num !== null) meta.push('点赞: ' + info.stats.like_num);
  if (info.stats && info.stats.friend_like_num !== null) meta.push('在看: ' + info.stats.friend_like_num);
  if (meta.length) { L.push('> ' + meta.join('　|　')); L.push(''); }
  if (info.digest) { L.push('> ' + info.digest); L.push(''); }
  L.push('');
  for (const b of info.content_blocks) {
    if (b.type === 'text') { L.push(b.text); L.push(''); }
    else if (b.type === 'image') {
      const local = b.local_file || b.url;
      L.push('![' + (b.format || 'img') + '](' + local + ')'); L.push('');
    } else if (b.type === 'video') {
      L.push('[视频 ' + (b.vid || '') + '](' + (b.mp4_url || b.playerUrl) + ')'); L.push('');
    } else if (b.type === 'link') {
      L.push('[' + (b.text || b.href) + '](' + b.href + ')'); L.push('');
    }
  }
  if (info.comments && info.comments.items && info.comments.items.length) {
    L.push('---');
    L.push('## 评论');
    L.push('');
    for (const c of info.comments.items) {
      L.push('- **' + c.nickname + '**（' + c.create_time_display + '，赞 ' + c.like_num + '）: ' + c.content);
      for (const r of c.replies) {
        L.push('  - ' + (r.author_reply ? '作者回复 ' : '') + r.nickname + ': ' + r.content);
      }
    }
  }
  return L.join('\n');
}

function buildStandaloneHtml(info) {
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const body = info.content_html || esc(info.content_text || '');
  const metaRows = [];
  const push = (k, v) => { if (v) metaRows.push('<span class="k">' + k + '</span> ' + esc(v)); };
  push('公众号', info.account && info.account.nickname);
  push('作者', info.author);
  push('发布时间', info.publish_time && info.publish_time.display);
  push('原文', info.url);
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(info.title) + '</title>\n' +
    '<style>body{max-width:760px;margin:0 auto;padding:24px;font-family:-apple-system,"PingFang SC",sans-serif;line-height:1.8;color:#222}' +
    'h1{font-size:22px}.meta{color:#888;font-size:13px;margin:8px 0 24px;border-bottom:1px solid #eee;padding-bottom:12px}' +
    '.k{background:#f2f2f2;border-radius:3px;padding:1px 6px;margin-right:8px}' +
    'img{max-width:100%;height:auto}video{max-width:100%}blockquote{color:#666;border-left:3px solid #ddd;margin:8px 0;padding-left:12px}</style>\n' +
    '</head>\n<body>\n<h1>' + esc(info.title) + '</h1>\n<div class="meta">' + metaRows.join('<br>') + '</div>\n' +
    '<div class="content">' + body + '</div>\n</body>\n</html>\n';
}

// ---------------------------------------------------------------- main

async function fetchArticle(url, opts) {
  const out = {
    ok: false,
    url: url,
    final_url: '',
    fetched_at: new Date().toISOString(),
    title: '',
    author: '',
    account: { nickname: '', nickname_source: '', gh_id: '', biz: '' },
    publish_time: { timestamp: 0, display: '' },
    digest: '',
    cover_url: '',
    source_url: '',
    album: null,
    tags: [],
    stats: null,
    content_text: '',
    content_html: '',
    content_blocks: [],
    images: [],
    image_downloads: [],
    videos: [],
    links: [],
    comments: null,
    files: {},
    warnings: [],
    error: '',
  };

  // 1. fetch page
  let html = '';
  try {
    const res = await fetchText(url, opts);
    html = res.text;
    out.final_url = res.finalUrl;
    if (looksLikeVerification(html)) {
      out.error = 'anti_bot_verification';
      out.warnings.push('WeChat returned a verification page (环境异常/验证码). Try again later or use a login cookie.');
      return out;
    }
  } catch (e) {
    out.error = 'fetch_failed: ' + (e && e.message ? e.message : String(e));
    return out;
  }

  // 2. metadata
  const meta = pickMeta(html);
  out.title = meta.title || '未命名文章';
  out.author = meta.author || '';
  out.digest = meta.digest || '';
  out.cover_url = normalizeUrl(meta.cover_url) || '';
  out.source_url = normalizeUrl(meta.source_url) || '';
  out.account.gh_id = meta.gh_id || '';
  out.account.biz = meta.biz || '';
  if (meta.nickname) {
    out.account.nickname = meta.nickname;
    out.account.nickname_source = 'page_script';
  } else if (meta.nickname_hint) {
    out.account.nickname = meta.nickname_hint;
    out.account.nickname_source = 'album_title_hint';
  } else {
    out.account.nickname_source = 'unavailable';
    out.warnings.push('account nickname not embedded in page (new-style pages hide it); gh_id/biz available instead');
  }
  const ct = Number(meta.create_time) || 0;
  out.publish_time.timestamp = ct;
  out.publish_time.display = meta.create_time_display || fmtTime(ct);

  // 3. content
  const bodyHtml = extractJsContent(html);
  if (!bodyHtml) {
    // distinguish "deleted / expired / violates rules" pages from real failures
    const weuiTitle = html.match(/class=["'][^"']*weui-msg__title[^"']*["'][^>]*>([\s\S]*?)<\//i);
    const weuiDesc = html.match(/class=["'][^"']*weui-msg__desc[^"']*["'][^>]*>([\s\S]*?)<\//i);
    if (weuiTitle || weuiDesc) {
      out.error = 'article_unavailable';
      out.warnings.push('WeChat says: ' + stripTags((weuiTitle ? weuiTitle[1] : '') + ' ' + (weuiDesc ? weuiDesc[1] : '')).trim());
      return out;
    }
    out.error = 'content_not_found';
    out.warnings.push('js_content div not found; page may be a redirect or verification page');
    return out;
  }
  out.content_html = bodyHtml.trim();
  out.content_blocks = tokenizeContent(bodyHtml);
  out.content_text = out.content_blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n');
  out.images = extractImages(bodyHtml);
  out.links = extractLinks(bodyHtml);
  const videoBlocks = out.content_blocks.filter((b) => b.type === 'video');
  for (const vb of videoBlocks) {
    if (!vb.vid && vb.directSrc) {
      out.videos.push({ vid: '', player_url: vb.directSrc, mp4_url: vb.directSrc, note: 'direct <video> src' });
      continue;
    }
    if (!vb.vid) continue;
    if (!out.videos.some((v) => v.vid === vb.vid)) {
      out.videos.push({ vid: vb.vid, player_url: vb.playerUrl, mp4_url: null, note: '' });
    }
  }

  // 4. stats + comments (best-effort, may need cookie)
  if (opts.tryStats || opts.tryComments) {
    out.stats = await fetchStats(meta, opts);
    out.album = out.stats.album || null;
    out.tags = out.stats.tags || [];
    out.comments = await fetchComments(meta, opts);
  } else {
    out.stats = { read_num: null, like_num: null, old_like_num: null, friend_like_num: null, note: 'disabled' };
    out.comments = { total: null, items: [], note: 'disabled' };
  }

  // 5. resolve video mp4 urls (best-effort)
  for (const v of out.videos) {
    if (v.vid) {
      const mp4 = await resolveVideoUrl(v.vid, meta, opts);
      if (mp4) v.mp4_url = mp4;
      else v.note = 'mp4 url not resolvable anonymously (login cookie may help)';
    }
  }

  out.ok = true;
  return out;
}

async function saveFiles(info, opts) {
  const ts = info.publish_time.timestamp
    ? fmtTime(info.publish_time.timestamp).slice(0, 10)
    : info.fetched_at.slice(0, 10);
  const accountDir = safeFilename(info.account.nickname || info.account.gh_id || 'unknown_account', 40);
  const articleDir = safeFilename(ts + '_' + info.title, 120);
  const base = path.join(opts.outDir, accountDir, articleDir);
  const imagesDir = path.join(base, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  // image download (optional)
  let downloadResults = [];
  if (opts.downloadImages && info.images.length) {
    log('downloading ' + info.images.length + ' images ...');
    downloadResults = await downloadImages(info.images, imagesDir, opts);
  }
  // map local files into content blocks
  const byIndex = {};
  for (const r of downloadResults) {
    if (r.file) byIndex[r.index] = 'images/' + r.file;
  }
  let imgCursor = 0;
  for (const b of info.content_blocks) {
    if (b.type === 'image') {
      imgCursor += 1;
      const local = byIndex[imgCursor];
      if (local) b.local_file = local;
    }
  }
  info.image_downloads = downloadResults;
  info.files = {
    dir: base,
    markdown: path.join(base, 'article.md'),
    html: path.join(base, 'article.html'),
    meta: path.join(base, 'meta.json'),
    images_dir: imagesDir,
    images_downloaded: downloadResults.filter((r) => r.file).length,
  };

  const md = buildMarkdown(info);
  fs.writeFileSync(path.join(base, 'article.md'), md, 'utf8');
  fs.writeFileSync(path.join(base, 'article.html'), buildStandaloneHtml(info), 'utf8');
  const metaCopy = Object.assign({}, info);
  delete metaCopy.content_html;
  fs.writeFileSync(path.join(base, 'meta.json'), JSON.stringify(metaCopy, null, 2), 'utf8');
  return info;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.urls.length) {
    process.stderr.write('usage: node fetch_wechat_article.js <url> [--cookie C] [--no-images] [--out DIR] [--json] [--max-retries N]\n');
    process.exit(2);
  }
  const results = [];
  for (let i = 0; i < opts.urls.length; i++) {
    const url = opts.urls[i];
    if (i > 0) await sleep(1500 + Math.random() * 1500);
    log('fetching ' + url);
    let info;
    try {
      if (isChannelsUrl(url)) {
        info = await fetchChannelsFeed(url, opts);
        if (info.ok && !opts.jsonOnly) {
          info = await saveChannelsFiles(info, opts);
        }
      } else {
        info = await fetchArticle(url, opts);
        if (info.ok && !opts.jsonOnly) {
          info = await saveFiles(info, opts);
        }
      }
    } catch (e) {
      info = {
        ok: false, url: url, error: 'unexpected: ' + (e && e.message ? e.message : String(e)),
        fetched_at: new Date().toISOString(),
      };
    }
    results.push(info);
  }
  const outJson = opts.urls.length === 1 ? results[0] : { ok: true, count: results.length, articles: results };
  process.stdout.write(JSON.stringify(outJson, null, 2) + '\n');
}

main().catch((e) => {
  process.stderr.write('[wechat-fetcher] fatal: ' + (e && e.stack ? e.stack : String(e)) + '\n');
  process.exit(1);
});
