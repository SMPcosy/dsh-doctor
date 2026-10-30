#!/usr/bin/env node
/**
 * dsh-diag.mjs —— DSH 弹窗报错一站式诊断（把原 5 个工具合成一个入口）
 *
 * 子命令：
 *   node dsh-diag.mjs                     # = doctor：profile 检查 + 最新日志判族 + 网络快检
 *   node dsh-diag.mjs doctor [--json] [--full]
 *   node dsh-diag.mjs logs [--list] [--all] [<log 路径>]
 *   node dsh-diag.mjs net  [--json] [url ...]
 *   node dsh-diag.mjs lock
 *   node dsh-diag.mjs fix-lock [--apply] [--kill]
 *   node dsh-diag.mjs help
 *
 * 来源（原工具，全部保留未删）：
 *   crash-log-reader.mjs      → logs 子命令
 *   diag-fetch-failed.mjs     → net 子命令
 *   repair-dsh-profile-lock.ps1 → fix-lock 子命令（作为执行体被调用，ACL 逻辑不重写）
 *   看崩溃日志.mjs / .cmd      → 入口别名，仍可用
 *
 * 退出码：0 全部正常；1 发现问题；2 参数/环境错误。
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, openSync, closeSync, unlinkSync, cpSync, mkdtempSync, rmSync, readSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

// 打成单文件 exe（SEA）后，用法行应显示 exe 名字，而不是 `node xxx.mjs`。
// 判据不用 node:sea —— 它在 CJS 打包里要额外 require，SEA 里 argv[1] 就等于 execPath。
const IS_SEA = !!process.argv[1] && process.argv[1] === process.execPath;
const PROG = IS_SEA ? basename(process.execPath) : 'node dsh-diag.mjs';

// 版本号：发版时只改这一处（help / version / 菜单标题都读它）
const VERSION = '0.5.0';

// ───────────────────────────── 输出小工具 ─────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), red = paint('31'), green = paint('32');
const yellow = paint('33'), cyan = paint('36'), gray = paint('90');
const BAD = red('[x]'), WARN = yellow('[!]'), OK = green('[ok]'), INFO = cyan('[i]');
const rule = (ch = '─') => ch.repeat(64);
const say = (...a) => console.log(...a);

// 管道被提前关闭（`| head`、`Select-Object -First N`）时不要抛 EPIPE 崩掉
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });

/** Windows 中文控制台按 GBK 输出；Node 默认 UTF-8 解会乱码，这里两种都试。 */
function decode(buf) {
  try { return new TextDecoder('gbk').decode(buf); } catch { return buf.toString('utf8'); }
}
function runCmd(file, args, timeout = 20000) {
  const r = spawnSync(file, args, { encoding: 'buffer', timeout, windowsHide: true });
  return {
    ok: r.status === 0,
    status: r.status,
    out: r.stdout ? decode(r.stdout) : '',
    err: r.stderr ? decode(r.stderr) : '',
  };
}

// ────────────────────── A. 崩溃日志判读（14 族） ──────────────────────
const CODES =
  /\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|EPROTO|EPIPE|CERT_[A-Z_]+|ERR_TLS_[A-Z_]+|SELF_SIGNED_CERT[A-Z_]*|UNABLE_TO_VERIFY[A-Z_]*|UND_ERR_[A-Z_]+|EPERM|EACCES|ENOENT|EBUSY|EEXIST)\b/gu;

function logsDir() {
  const appdata = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  return join(appdata, '@deepseek-ai', 'dsh-desktop', 'logs');
}

function listLogs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^crash-.*\.log$/i.test(f))
    .map((f) => ({ file: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function parseLog(text) {
  const lines = text.split(/\r?\n/);
  const header = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^([a-z][a-z ]*?):\s*(.*)$/u.exec(lines[i]);
    if (!m) break;
    header[m[1].trim()] = m[2].trim();
  }
  const sections = [];
  let cur = null;
  for (; i < lines.length; i++) {
    const m = /^---\s*(.+?)\s*---$/u.exec(lines[i]);
    if (m) { cur = { name: m[1], lines: [] }; sections.push(cur); continue; }
    if (cur) cur.lines.push(lines[i]);
  }
  return { header, sections };
}

const uniq = (a) => [...new Set(a)];

/** 族判读：按优先级匹配，返回 [族别, 下一步]。 */
function verdict(message, all) {
  const t = `${message}\n${all}`;
  const hit = (re) => re.test(t);
  if (hit(/is not valid JSON|Unexpected token/i))
    return ['族 A：启动期 JSON 解析崩溃', '校正 profile 的 package.json（用 node -e "JSON.parse(...)" 验一遍再启动）'];
  // rc.3 的 subagentTiming 投影直接读 turn/end 的 reason.kind；reason 落成 null 就炸在物化阶段，
  // host 起不来 → 「应用无法启动」弹窗。修日志而不是修代码：
  if (hit(/reading 'kind'\)/) && hit(/dsh-session-projection|dsh-subagent[\\/]lib[\\/]index\.js/))
    return ['族 N：会话日志被 turn/end reason=null 毒化',
      '本工具 sessions --fix 原地修（原件留 .dshfix.bak），再重启 DSH'];
  // 开机时 host 还没起监听就 fetch，必失败；等一秒重开就好，不是真故障。
  if (hit(/net::ERR_CONNECTION_REFUSED/) && hit(/^source: (main|web-boot)$/mu) && hit(/phase: running/))
    return ['启动竞态：host 未就绪（无害）', '关干净所有 DSH 进程再开一次；只有反复出现才去查端口占用'];
  if (hit(/agent-preset\/not-found|未知的代理预设/))
    return ['族 H：代理预设缺失', '恢复 presets 层，或把会话的 preset 改成 standard'];
  // 两种退出码都要认得：
  //  · `host exited with 1:` → 退出码 1，一般是插件清单被跳过后的启动失败；
  //  · 其它退出码（如 1073807364 = 0x40010004）里夹同一句时，根因仍是这个包被跳过，
  //    只是宿主以别的码收摊；两个历史日志（10-25 / 10-26）就是这么落成「未归类」的。
  if (hit(/skipping profile bundle/i) && hit(/host exited with \d+:/))
    return ['族 B 变体 · profile 插件被跳过（版本不配）',
      '看被跳过的包名：把插件升到与内核匹配的版本，或 grant exact-version 豁免，或从 profile 的 bundles 里移除'];
  if (hit(/is unavailable|service-unavailable|did not activate|pending \(waiting for service/))
    return ['族 B：服务链未就绪', '日志里往上找第一个报错的插件 → 先禁第三方插件再逐条排'];
  if (hit(/unknown prompt variable/))
    return ['族 G：提示词变量非法', '删掉 patch 里 {{cwd}} 这类未注册变量'];
  if (hit(/Web RPC failed|Web request failed/))
    return ['族 C：欢迎窗 RPC 失败', '结束所有 DSH 进程、确认端口空闲后重启'];
  if (hit(/renderer exited: crashed/))
    return ['族 D：渲染进程崩溃', '关硬件加速 / 重置 GPU 缓存'];
  if (hit(/HTTP 401|Authentication Fails/))
    return ['族 E：鉴权失败', '重新登录或换 API key，并确认不是代理改写请求'];
  if (hit(/\bTRANSPORT\b|transport failed/))
    return ['族 F：模型传输失败', '查网络/代理/TLS'];
  // rc.5 的更新器先替换 resources 并重启应用，再慢慢铺 resources\runtime（node/pnpm/office-skills）。
  // 窗口期里 office 七件套的 SKILL.md 还没落盘，而 dsh-skill-office 的 apply() 是「任一缺失就 throw」，
  // host 直接起不来、更新器又自动重启 → 20 秒连撞 5 次。先认这个，再谈「安装不完整」。
  if (hit(/office-skills/i) && hit(/ENOENT/) && hit(/resources[\\/]runtime/i))
    return ['族 O：更新窗口期 runtime 载荷未就位',
      '不是装坏了：等 installer 铺完再启动（本工具 runtime --wait 300 --launch 一条命令搞定）；更新器只重试有限次（本机 5 次后就不再来），铺完不会自己好，必须有人重启一次；只有 runtime 目录不新且一直缺才重装'];
  if (hit(/ENOENT.*SKILL\.md|resources[\\/]runtime[\\/]/i))
    return ['族 J′：安装包不完整（运行时资源没就位）', '多半是更新/安装未完成：重装或等更新跑完再启动'];
  if (hit(/\bEPERM\b.*\bopen\b|operation not permitted/))
    return ['族 I：profile 目录权限被拒', '修目录 ACL（本工具 fix-lock --apply）'];
  if (hit(/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|getaddrinfo|EHOSTUNREACH|socket hang up|UND_ERR|CERT_|ETIMEDOUT/))
    return ['族 J：网络层致命错误（fetch failed）', '用本工具 net 子命令分层定位：DNS / 连接 / TLS / 代理'];
  if (hit(/EACCES|EBUSY/))
    return ['权限/占用类', '关掉占用进程，或用管理员修安装目录权限'];
  return ['未归类', '把「原始 error 段」前 40 行贴出来再判'];
}

function analyzeLog(file) {
  const text = readFileSync(file, 'utf8');
  const { header, sections } = parseLog(text);
  const errBody = (sections.find((s) => /^error/u.test(s.name))?.lines ?? []).join('\n');
  const diagBody = (sections.find((s) => /diagnostic/u.test(s.name))?.lines ?? []).join('\n');
  const errLines = errBody.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 结论行挑「真致命」的那条：日志里前面常有一串插件不兼容的 disabling 行，直接取第一行会答非所问。
  const message = errLines.find((l) => /fatal (load )?failure|fatal error/i.test(l)) ?? errLines[0] ?? '';
  const frames = uniq([...text.matchAll(/^\s+at\s+(.+)$/gmu)].map((m) => m[1].trim()));
  const appFrames = frames.filter((f) => /node_modules[\\/]@[^\\/]+[\\/][^\\/]+[\\/]lib[\\/]|app\.asar[\\/]lib[\\/]/u.test(f));
  const urls = uniq([...text.matchAll(/https?:\/\/[^\s'"<>)\]，。]+/gu)].map((m) => m[0].replace(/[.,;:]$/u, '')));
  const codes = uniq([...text.matchAll(CODES)].map((m) => m[0]));
  const causes = uniq([...text.matchAll(/^\s*(?:cause|\[cause\])[^\n]*$/gmu)].map((m) => m[0].trim())).slice(0, 6);
  const [family, next] = verdict(message, text);
  return { file, header, message, family, next, urls, codes, causes, appFrames: appFrames.slice(0, 4), errBody, diagBody };
}

const logOneLine = (file) => {
  try {
    const a = analyzeLog(file);
    return `${basename(file)}  →  ${a.family} ｜ ${a.message.slice(0, 80)}`;
  } catch (e) { return `${basename(file)}  →  解析失败：${e.message}`; }
};

function printLogReport(a) {
  const H = a.header, L = (k, v) => (v ? `  ${k.padEnd(10)} ${v}` : null);
  say(rule('═'));
  say(`文件：${a.file}`);
  say([L('时间(UTC)', H.time), L('来源', H.source),
    L('阶段', H.phase + (H.phase === 'startup' ? '   ← 启动期就崩了' : H.phase === 'running' ? '   ← 启动成功，是运行中被打死' : '')),
    L('版本', H.app), L('electron', H.electron ? `${H.electron} / node ${H.node ?? '?'}` : '')].filter(Boolean).join('\n'));
  say(rule());
  say(`判读：${bold(a.family)}`);
  say(`结论：${a.message}`);
  say(`下一步：${a.next}`);
  if (a.codes.length) say(`系统错误码：${a.codes.join(', ')}`);
  if (a.urls.length) { say('涉及 URL：'); a.urls.slice(0, 8).forEach((u) => say(`  · ${u}`)); }
  else if (/fetch failed/i.test(a.message)) say('涉及 URL：（log 里没有 URL —— 说明失败发生在请求发出前：DNS / 建连 / TLS / 代理）');
  if (a.causes.length) { say('cause 链：'); a.causes.forEach((c) => say(`  · ${c.replace(/\s+/gu, ' ').slice(0, 300)}`)); }
  if (a.appFrames.length) { say('最内层应用栈帧（→ 指向哪个包）：'); a.appFrames.forEach((f) => say(`  · ${f}`)); }
  say(rule('─') + ' 原始 error 段 ' + rule('─'));
  say(a.errBody.split(/\r?\n/).slice(0, 22).join('\n').trimEnd());
  if (a.diagBody.trim()) {
    say(rule('─') + ' host 自报诊断 ' + rule('─'));
    say(a.diagBody.split(/\r?\n/).slice(0, 26).join('\n').trimEnd());
  }
  say(rule('═'));
}

function cmdLogs(argv) {
  const wantList = argv.includes('--list');
  const wantAll = argv.includes('--all');
  const explicit = argv.find((a) => !a.startsWith('--'));
  const dir = logsDir();
  const logs = explicit ? [] : listLogs(dir);

  if (wantList) {
    say(`日志目录：${dir}`);
    if (!logs.length) { say('（没有找到 crash-*.log）'); return 0; }
    logs.forEach((l) => say(logOneLine(l.file)));
    return 0;
  }
  let target = explicit;
  if (!target) {
    if (!logs.length) { say(`日志目录：${dir}\n（没有找到 crash-*.log —— 弹窗里给的路径是什么就读那个）`); return 1; }
    target = logs[0].file;
  }
  if (!existsSync(target)) { say(`${BAD} 读不到文件：${target}`); return 2; }
  printLogReport(analyzeLog(target));
  if (wantAll && logs.length > 1) {
    say('\n全部日志一览（新 → 旧）：');
    logs.forEach((l) => say('  ' + logOneLine(l.file)));
  }
  return 0;
}

// ───────────────────── B. 网络四层（fetch failed） ─────────────────────
const PROXY_PORTS = [7890, 7897, 1080, 10809, 8889, 8080];
const TIMEOUT = Number(process.env.DIAG_TIMEOUT_MS || 8000);
const t0 = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const ms = (a) => `${(t0() - a).toFixed(0)}ms`;

function causeChain(err, depth = 0, out = []) {
  if (!err || depth > 6) return out;
  const one = { depth, name: err.name || typeof err, message: String(err.message ?? err) };
  for (const k of ['code', 'errno', 'syscall', 'hostname', 'address', 'port', 'reason'])
    if (err[k] !== undefined && err[k] !== '') one[k] = err[k];
  if (Array.isArray(err.errors)) one.aggregate = err.errors.length;
  out.push(one);
  if (Array.isArray(err.errors)) err.errors.forEach((e) => causeChain(e, depth + 1, out));
  if (err.cause) causeChain(err.cause, depth + 1, out);
  return out;
}

function diagnoseNet(chain) {
  const text = chain.map((c) => `${c.code ?? ''} ${c.name} ${c.message}`).join(' | ');
  const has = (s) => text.includes(s);
  if (has('bad port')) return ['端口被 Node/undici 列入禁用列表', '换端口；这是 fetch 规范禁止访问这些端口，不是网络问题'];
  if (has('CERT_HAS_EXPIRED')) return ['证书已过期', '先 `w32tm /resync` 校时，再看对方证书'];
  if (has('SELF_SIGNED_CERT') || has('UNABLE_TO_VERIFY_LEAF_SIGNATURE') || has('UNABLE_TO_GET_ISSUER'))
    return ['TLS 证书验不过（多半是公司/杀软中间解密 https）', '导出拦截根证书后设 `NODE_EXTRA_CA_CERTS=路径`，或让 IT 放行'];
  if (has('ENOTFOUND') || has('EAI_AGAIN')) return ['DNS 解析失败', '换 DNS（223.5.5.5 / 1.1.1.1）、查 hosts、关掉已退出代理残留的 DNS 设置'];
  if (has('ECONNREFUSED')) return ['对方端口没在监听', '本地代理/服务没启动；`netstat -ano | findstr :端口` 查'];
  if (has('CONNECT_TIMEOUT') || has('ETIMEDOUT') || has('TimeoutError') || has('timeout'))
    return ['连不上（超时）', '网络不通 / 被墙 / VPN 掉线 / 防火墙；换网络、确认代理生效'];
  if (has('ECONNRESET') || has('other side closed') || has('socket hang up') || has('UND_ERR_SOCKET'))
    return ['连接被中途掐断', '代理或 VPN 不稳、MTU 过大、服务端主动断；重试 + 换线路'];
  if (has('ENETUNREACH') || has('EHOSTUNREACH'))
    return ['路由不可达', '本机没网 / IPv6 走到死胡同；试 `--dns-result-order=ipv4first`'];
  if (has('aggregate')) return ['多地址全部失败（v4/v6 都试过）', '按里面每一条分别处置，通常是 DNS 污染或全局限流'];
  if (chain.length === 1) return ['只拿到裸的 fetch failed，真实原因被吞', '把日志里紧跟其后的 cause 行贴出来，或重跑本命令'];
  return ['未归类的网络层失败', '把 cause 链整段发出来再判'];
}

async function checkProxyEnv() {
  const env = {};
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'])
    if (process.env[k]) env[k] = process.env[k];
  const listening = [];
  for (const port of PROXY_PORTS) {
    const ok = await new Promise((res) => {
      const s = net.connect({ host: '127.0.0.1', port, timeout: 400 });
      s.once('connect', () => { s.destroy(); res(true); });
      s.once('error', () => res(false));
      s.once('timeout', () => { s.destroy(); res(false); });
    });
    if (ok) listening.push(port);
  }
  return { env, listeningLocalPorts: listening };
}

async function checkDns(host) {
  if (net.isIP(host)) return { ip: true, addresses: [`ip:${host}`], elapsedMs: 0, lookup: [host] };
  const out = { addresses: [], errors: [] }, start = t0();
  for (const [family, fn] of [[4, dns.resolve4], [6, dns.resolve6]]) {
    try { out.addresses.push(...(await fn(host)).map((a) => `v${family}:${a}`)); }
    catch (e) { out.errors.push(`v${family}:${e.code || e.message}`); }
  }
  out.elapsedMs = Number((t0() - start).toFixed(0));
  try { out.lookup = (await dns.lookup(host, { all: true })).map((a) => `v${a.family}:${a.address}`); }
  catch (e) { out.lookupError = e.code || e.message; }
  return out;
}

function checkTcp(host, port) {
  return new Promise((resolve) => {
    const start = t0(), s = net.connect({ host, port });
    const done = (r) => { s.destroy(); resolve({ ...r, elapsedMs: Number((t0() - start).toFixed(0)) }); };
    s.setTimeout(TIMEOUT, () => done({ ok: false, code: 'ETIMEDOUT' }));
    s.once('connect', () => done({ ok: true, localPort: s.localPort }));
    s.once('error', (e) => done({ ok: false, code: e.code || e.name, message: e.message }));
  });
}

function checkTls(host, port, servername) {
  return new Promise((resolve) => {
    const start = t0(), s = tls.connect({ host, port, servername, rejectUnauthorized: true });
    const done = (r) => { s.destroy(); resolve({ ...r, elapsedMs: Number((t0() - start).toFixed(0)) }); };
    s.setTimeout(TIMEOUT, () => done({ ok: false, code: 'ETIMEDOUT' }));
    s.once('secureConnect', () => {
      const c = s.getPeerCertificate() || {};
      done({ ok: s.authorized, authorizationError: s.authorizationError || undefined, subject: c.subject?.CN,
        issuer: c.issuer?.CN || c.issuer?.O, validTo: c.valid_to, protocol: s.getProtocol() });
    });
    s.once('error', (e) => done({ ok: false, code: e.code || e.name, message: e.message }));
  });
}

async function checkFetch(url) {
  const start = t0();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'user-agent': 'dsh-diag/1.0' } });
    return { ok: true, status: res.status, server: res.headers.get('server') || undefined, elapsedMs: Number((t0() - start).toFixed(0)) };
  } catch (e) {
    return { ok: false, elapsedMs: Number((t0() - start).toFixed(0)), chain: causeChain(e) };
  }
}

async function checkUrl(raw) {
  const url = new URL(raw);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const host = url.hostname;
  const r = { url: raw, host, port, protocol: url.protocol };
  r.dns = await checkDns(host);
  r.tcp = await checkTcp(host, port);
  if (url.protocol === 'https:' && r.tcp.ok) r.tls = await checkTls(host, port, host);
  r.http = await checkFetch(raw);
  if (!r.http.ok) r.verdict = diagnoseNet(r.http.chain);
  return r;
}

async function runNet(urls, opts = {}) {
  const { json = false, silent = false } = opts;
  const report = { at: new Date().toISOString(), node: process.version, platform: `${process.platform} ${process.arch}`,
    proxy: await checkProxyEnv(), targets: [] };
  for (const u of urls) {
    try { report.targets.push(await checkUrl(u)); }
    catch (e) { report.targets.push({ url: u, fatal: e.message }); }
  }
  if (silent) return report;
  if (json) { say(JSON.stringify(report, null, 2)); return report; }

  say(`DSH fetch 诊断  ${report.at}`);
  say(`node ${report.node} · ${report.platform}`);
  say('\n== 0 代理环境 ==');
  const env = report.proxy.env;
  say(env && Object.keys(env).length ? Object.entries(env).map(([k, v]) => `  ${k}=${v}`).join('\n') : '  没有 HTTP(S)_PROXY 等变量');
  say(`  本地常见代理端口在监听：${report.proxy.listeningLocalPorts.length ? report.proxy.listeningLocalPorts.join(', ') : '无'}`);
  for (const t of report.targets) {
    say(`\n== ${t.url} ==`);
    if (t.fatal) { say(`  ${BAD} ${t.fatal}`); continue; }
    say(`  1 DNS  ${t.dns.addresses?.length ? t.dns.addresses.join(', ') + `  (${t.dns.elapsedMs}ms)` : '解析失败 ' + (t.dns.errors || []).join(', ')}`);
    say(`  2 TCP  ${t.tcp.ok ? `连上 (${t.tcp.elapsedMs}ms)` : `失败 ${t.tcp.code} ${t.tcp.message || ''}`}`);
    if (t.tls) say(`  3 TLS  ${t.tls.ok ? `通过 ${t.tls.protocol} 签发者=${t.tls.issuer} 到期=${t.tls.validTo}` : `失败 ${t.tls.code || t.tls.authorizationError} ${t.tls.message || ''}`}`);
    say(`  4 HTTP ${t.http.ok ? `${t.http.status} (${t.http.elapsedMs}ms)` : `抛错 (${t.http.elapsedMs}ms)`}`);
    if (!t.http.ok) {
      t.http.chain.forEach((c) => say(`     cause[${c.depth}] ${c.name}: ${c.message}${c.code ? ` [${c.code}]` : ''}`));
      say(`  => 结论：${t.verdict[0]}`);
      say(`  => 处置：${t.verdict[1]}`);
    }
  }
  const failed = report.targets.filter((t) => t.fatal || !t.http?.ok).length;
  say('');
  say(failed ? `结果：${failed}/${report.targets.length} 个目标失败，看上面的「结论/处置」。`
    : '结果：全部通过 —— 当前网络能正常访问；若 DSH 仍报 fetch failed，查它自己的代理设置或具体域名。');
  return report;
}

// ─────────────────── C. profile 目录 / 锁（只读检查） ───────────────────
function profilePaths() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  const profile = process.env.DSH_PROFILE || 'desktop';
  const dir = join(home, 'profiles', profile);
  return { home, profile, dir, lock: join(dir, 'lock') };
}

function checkProfile() {
  const p = profilePaths();
  const out = { ...p, homeExists: existsSync(p.home), dirExists: existsSync(p.dir), lock: null, acl: null, writable: null, error: null };

  if (existsSync(p.lock)) {
    const st = statSync(p.lock);
    out.lock = { exists: true, isDir: st.isDirectory(), bytes: st.size };
  } else out.lock = { exists: false };

  // 写权限探针：建一个临时文件再删，不碰真正的 lock
  if (out.dirExists) {
    const probe = join(p.dir, `.dsh-diag-probe-${process.pid}`);
    try { closeSync(openSync(probe, 'wx')); unlinkSync(probe); out.writable = true; }
    catch (e) { out.writable = false; out.error = `${e.code || e.name}: ${e.message}`; }
  }

  // ACL：只看 DENY，不做任何修改
  if (out.homeExists) {
    const r = runCmd('icacls', [p.home]);
    if (r.ok || r.out) {
      const lines = r.out.split(/\r?\n/).filter((l) => l.trim() && !/Successfully processed|Failed processing|已成功处理|处理/.test(l));
      out.acl = { denies: lines.filter((l) => /\(DENY\)|\(拒绝\)/.test(l)), lines };
    }
  }
  return out;
}

function printProfile(pr) {
  say(`DSH home    : ${pr.home}${pr.homeExists ? '' : '   ' + BAD + ' 不存在'}`);
  say(`profile dir : ${pr.dir}${pr.dirExists ? '' : '   ' + WARN + ' 不存在（首次启动会自动建）'}`);
  if (pr.lock.exists) {
    say(`lock        : ${pr.lock.isDir ? BAD + ' 是目录（异常，必须删）' : '文件 ' + pr.lock.bytes + ' 字节'}   ${WARN} 残留锁会让下次启动报 EEXIST`);
  } else say(`lock        : 无残留   ${OK}`);
  if (pr.writable === true) say(`写权限      : CREATE_NEW 成功   ${OK} DSH 能创建锁文件`);
  if (pr.writable === false) say(`写权限      : CREATE_NEW 失败   ${BAD} ${pr.error}\n              多半是 DENY ACE 或安全软件目录保护 → fix-lock --apply`);
  if (pr.acl) {
    if (pr.acl.denies.length) { say(`ACL         : ${pr.acl.denies.length} 条 DENY   ${BAD}`); pr.acl.denies.forEach((l) => say(`  ${l.trim()}`)); }
    else say(`ACL         : 无 DENY 条目   ${OK}`);
  }
}

// ───────────────────── D. 修复：转交 PowerShell ─────────────────────
function findRepairScript() {
  const bases = [SELF_DIR, dirname(SELF_DIR), process.cwd()];
  const names = ['repair-dsh-profile-lock.ps1', 'repair-dsh.ps1'];
  for (const base of bases) for (const n of names) {
    const p = join(base, n);
    if (existsSync(p)) return p;
  }
  return null;
}

function cmdFixLock(argv) {
  const apply = argv.includes('--apply');
  const kill = argv.includes('--kill');
  const script = findRepairScript();
  if (!script) { say(`${BAD} 找不到 repair-dsh-profile-lock.ps1（应与本文件同目录）`); return 2; }
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script];
  if (!apply) args.push('-DryRun');
  if (kill) args.push('-KillProcesses');
  say(`${INFO} 执行：powershell ${args.slice(3).join(' ')}${apply ? '' : '   （默认只演练，真修加 --apply）'}`);
  say(rule());
  const r = spawnSync('powershell', args, { stdio: 'inherit', windowsHide: false });
  say(rule());
  return r.status ?? 1;
}

// ───────────────────────────── E. doctor ─────────────────────────────
async function cmdDoctor(argv) {
  const asJson = argv.includes('--json');
  const full = argv.includes('--full');
  const pr = checkProfile();
  const rtEarly = checkRuntime();
  const dir = logsDir();
  const logs = listLogs(dir);
  const latest = logs[0] ? analyzeLog(logs[0].file) : null;
  const sessionScan = scanSessions();
  const netTargets = full
    ? ['https://api.deepseek.com/', 'https://www.baidu.com/', 'https://registry.npmjs.org/']
    : ['https://api.deepseek.com/'];
  const netReport = await runNet(netTargets, { silent: true });

  const problems = [];
  if (!pr.homeExists) problems.push('DSH home 不存在（DSH 未安装或用了别的用户）');
  if (pr.writable === false) problems.push('profile 目录不可写 → fix-lock --apply');
  if (pr.lock.exists && pr.lock.isDir) problems.push('lock 是目录（异常）');
  if (latest) {
    // 启动竞态那种（host 未就绪就 fetch）不是故障，别拿它当「最近一次崩溃」报出来；
    // 往前翻 6 份，找最近一次真崩的。
    const recent = logs.filter((l) => Date.now() - l.mtime <= 72 * 36e5).slice(0, 6);
    const real = recent.map((l) => analyzeLog(l.file)).find((a) => !/启动竞态/u.test(a.family));
    if (real) {
      const ageH = (Date.now() - statSync(real.file).mtimeMs) / 36e5;
      problems.push(`最近一次真崩溃（${ageH.toFixed(1)} 小时前）：${real.family}`);
    }
  }
  const netFailed = netReport.targets.filter((t) => t.fatal || !t.http?.ok).length;
  if (netFailed) problems.push(`网络：${netFailed}/${netTargets.length} 个目标失败 → 跑 net 看分层`);
  if (sessionScan.hits.length) {
    problems.push(`会话数据：${sessionScan.hits.length} 条 turn/end reason=null（会让 host 加载时 TypeError 崩）→ sessions --fix`);
  }

  if (asJson) {
    say(JSON.stringify({ at: new Date().toISOString(), profile: pr, latestLog: latest && {
      file: latest.file, family: latest.family, message: latest.message, codes: latest.codes },
      sessions: { files: sessionScan.files, turns: sessionScan.events, poisoned: sessionScan.hits.length },
      net: netReport,
      runtime: { root: rtEarly.root, state: rtEarly.state, missing: rtEarly.missing.map((m) => m.path) },
      problems }, null, 2));
    return problems.length ? 1 : 0;
  }

  say(rule('═') + '\n DSH 体检  ' + new Date().toLocaleString() + '\n' + rule('═'));
  say(`\n─ 1/5 profile 目录与锁 ${rule('─')}`);
  printProfile(pr);

  say(`\n─ 2/5 最新崩溃日志 ${rule('─')}`);
  if (!latest) say(`日志目录：${dir}\n（没有 crash-*.log —— 没崩过，或日志已被清理）`);
  else {
    const ageH = (Date.now() - logs[0].mtime) / 36e5;
    say(`文件：${basename(latest.file)}   (共 ${logs.length} 份，最近一次 ${ageH.toFixed(1)} 小时前)`);
    say(`判读：${bold(latest.family)}`);
    say(`结论：${latest.message.length > 300 ? latest.message.slice(0, 300) + ' …（完整见 logs）' : latest.message}`);
    say(`下一步：${latest.next}`);
    if (latest.codes.length) say(`错误码：${latest.codes.join(', ')}`);
  }

  say(`\n─ 3/5 网络 ${rule('─')}`);
  netReport.targets.forEach((t) => {
    if (t.fatal) { say(`  ${BAD} ${t.url}  ${t.fatal}`); return; }
    const okNet = t.http.ok;
    say(`  ${okNet ? OK : BAD} ${t.url}  DNS ${t.dns.elapsedMs}ms · TCP ${t.tcp.ok ? t.tcp.elapsedMs + 'ms' : t.tcp.code} · ` +
      (t.tls ? `TLS ${t.tls.ok ? 'ok' : t.tls.code || 'fail'} · ` : '') + `HTTP ${t.http.ok ? t.http.status : '抛错'}`);
    if (!okNet) say(`      → ${t.verdict[0]} ｜ ${t.verdict[1]}`);
  });

  say(`\n─ 4/5 会话数据 ${rule('─')}`);
  say(`目录：${sessionScan.root}（${sessionScan.files} 份会话，${sessionScan.events} 条 turn/end，${sessionScan.ms}ms）`);
  if (sessionScan.unsupported) say(`  ${WARN} 当前 Node 无 zstd 支持（需 ≥22.15），跳过解压扫描`);
  else if (!sessionScan.hits.length) say(`  ${OK} 无 reason=null 的 turn/end`);
  else {
    say(`  ${BAD} ${sessionScan.hits.length} 条 turn/end 的 reason 为 null —— host 加载会话时会 TypeError 崩`);
    sessionScan.hits.slice(0, 5).forEach((h) => say(`      seq ${h.seq}  ${basename(dirname(h.file))}`));
    say(`      → ${cyan('sessions --fix')} 原地修，原件留 .dshfix.bak`);
  }

  say(`
─ 5/5 安装载荷 ${rule('─')}`);
  const rt = rtEarly;
  say(`安装目录：${rt.root}`);
  const rtGuard = rt.items.find((i) => i.id === 'guard');
  if (rt.state === 'ok') say(`  ${OK} runtime 载荷齐全（${rt.items.filter((i) => i.ok).length}/${rt.items.length} 项）` + (rtGuard && rtGuard.ok ? '' : `；${WARN} skill-office 容错补丁没打，下次更新窗口期仍会崩`));
  else {
    say(`  ${BAD} ${rt.state === 'window' ? '更新窗口期：runtime 载荷还没铺完（族 O）' : rt.state === 'pending' ? '更新包已下载但没装完（族 O 变体）' : '安装不完整（族 J′）'}`);
    rt.missing.slice(0, 4).forEach((m) => say(`      缺 ${m.label}`));
    problems.push(`安装载荷：${rt.advice}`);
  }

  say('\n' + rule('═'));
  if (!problems.length) { say(` ${OK} 五项都没发现问题。仍报弹窗就把日志路径发出来：logs <路径>`); say(rule('═')); return 0; }
  say(` 发现 ${problems.length} 项：`);
  problems.forEach((p, i) => say(`  ${i + 1}. ${p}`));
  say(`\n 下一步：logs（看全量判读）｜ net（网络分层）｜ sessions --fix（会话数据）｜ runtime（安装载荷）｜ lock ｜ fix-lock --apply（修 ACL）`);
  say(rule('═'));
  return 1;
}

// ─────────── G. 会话数据体检：turn/end reason=null 毒化 ───────────
// 症状：开机/加载时 dsh 报 `fatal load failure: TypeError: Cannot read properties of null
// (reading 'kind')`，栈顶落在 dsh-session-projection 的 advanceCell → dsh-subagent 的投影。
// 原因：某次 turn 结束写了 { reason: null }；投影按 reason.kind 判读就炸，且这条事件永久留在
// 会话日志里，之后每次 materialize 都可能再炸。这里只读扫描 + 可选修复（改 never 不改别的）。
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const sessionsRoot = () => join(homedir(), '.dsh', 'sessions');

function decodeFrames(buf) {
  const parts = [];
  let off = 0, frames = 0, incomplete = 0;
  while (off < buf.length) {
    const idx = buf.indexOf(ZSTD_MAGIC, off);
    if (idx < 0) break;
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(idx)).toString('utf8')); frames += 1; }
    catch { incomplete += 1; break; }
    const next = buf.indexOf(ZSTD_MAGIC, idx + 4);
    off = next < 0 ? buf.length : next;
  }
  return { text: parts.join(''), frames, incomplete };
}

function walkSessions(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkSessions(p, out);
    else if (e.name === 'session.v4.jsonl.zstd') out.push(p);
  }
  return out;
}

function scanSessions(root = sessionsRoot()) {
  const started = Date.now();
  const files = walkSessions(root);
  if (typeof zlib.zstdDecompressSync !== 'function') {
    return { root, files: files.length, events: 0, hits: [], unsupported: true, ms: Date.now() - started };
  }
  const hits = [];
  let events = 0;
  for (const f of files) {
    let buf;
    try { buf = readFileSync(f); } catch { continue; }
    const { text } = decodeFrames(buf);
    if (!text.includes('"turn/end"')) continue;
    for (const line of text.split('\n')) {
      if (!line.trim() || !line.includes('"turn/end"')) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type !== 'turn/end') continue;
      events += 1;
      const reason = ev.data?.reason;
      if (reason === null || reason === undefined) hits.push({ file: f, seq: ev.seq, time: ev.time });
    }
  }
  return { root, files: files.length, events, hits, unsupported: false, ms: Date.now() - started };
}

function repairSessions(scan) {
  const repaired = [];
  for (const hit of scan.hits) {
    let buf, text;
    try { buf = readFileSync(hit.file); text = decodeFrames(buf).text; } catch { continue; }
    if (!text.includes('"reason":null')) continue;
    const next = text.replace(/"reason":null/g, '"reason":{"kind":"aborted"}');
    if (!next.split('\n').every((l) => !l.trim() || (() => { try { JSON.parse(l); return true; } catch { return false; } })())) continue;
    const bak = `${hit.file}.dshfix.bak`;
    if (!existsSync(bak)) writeFileSync(bak, buf);
    writeFileSync(hit.file, zlib.zstdCompressSync(Buffer.from(next, 'utf8')));
    repaired.push(hit.file);
  }
  return repaired;
}

function cmdSessions(argv) {
  const asJson = argv.includes('--json');
  const fix = argv.includes('--fix');
  const scan = scanSessions();
  const repaired = fix && scan.hits.length ? repairSessions(scan) : [];
  if (asJson) {
    say(JSON.stringify({ ...scan, repaired }, null, 2));
    return scan.hits.length && !repaired.length ? 1 : 0;
  }
  say(rule('═') + '\n 会话数据体检 turn/end.reason\n' + rule('═'));
  say(`目录：${scan.root}`);
  say(`文件：${scan.files} 份　turn/end 事件：${scan.events}　耗时：${scan.ms}ms`);
  if (scan.unsupported) { say(`${WARN} 当前 Node 没有 zstd 支持（需 ≥22.15）→ 跳过解压扫描`); return 2; }
  if (!scan.hits.length) { say(`${OK} 没有 reason=null 的 turn/end —— 投影不会再因为这个崩`); return 0; }
  say(`\n${BAD} 发现 ${scan.hits.length} 处被毒化的 turn/end：`);
  scan.hits.forEach((h) => say(`  seq ${h.seq}  ${h.file}`));
  if (repaired.length) {
    say(`\n${OK} 已修 ${repaired.length} 个文件（原件另存 *.dshfix.bak）`);
    say('下一步：重启 DSH。核心包已加空值保护，同样的坏事件不会再炸投影。');
    return 0;
  }
  say(`\n下一步：${cyan('sessions --fix')} 原地修（保留 .dshfix.bak），然后重启 DSH`);
  return 1;
}

// ───────────────────────────── F. 入口 ─────────────────────────────
// ─────────── H. 安装载荷体检：更新窗口期 runtime 未铺完（族 O） ───────────
// 现场（2026-10-30 21:32–21:50）：resources 在 21:32:49 被整体替换，runtime 目录 21:32:50 建出来，
// 但 office-skills\*\SKILL.md 的创建时间是 21:49:46、versions.json 21:50:04 —— 中间 17 分钟里
// 应用被更新器拉起来 5 次，每次都在 dsh-skill-office 的 readFileSync 上 ENOENT 崩掉。
const INSTALL_DEFAULT = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'DeepSeek Harness');
const OFFICE_SKILLS = ['office', 'office-docx', 'office-pptx', 'office-xlsx', 'office-render', 'office-recalculate', 'office-export-pdf'];

function birthOf(p) {
  try { const st = statSync(p); return st.birthtimeMs || st.mtimeMs || 0; } catch { return 0; }
}

function checkRuntime(root = INSTALL_DEFAULT) {
  const res = join(root, 'resources');
  const runtime = join(res, 'runtime');
  const items = [];
  const add = (id, label, p, optional = false) => {
    let ok = false, size = 0;
    try { const st = statSync(p); ok = st.isFile() ? st.size > 0 : true; size = st.size || 0; } catch {}
    items.push({ id, label, path: p, ok, size, optional });
  };
  add('app', '应用主体 resources\\app 或 app.asar', existsSync(join(res, 'app')) ? join(res, 'app') : join(res, 'app.asar'));
  add('versions', 'runtime\\versions.json', join(runtime, 'versions.json'));
  for (const s of OFFICE_SKILLS) add(`skill:${s}`, `runtime\\office-skills\\${s}\\SKILL.md`, join(runtime, 'office-skills', s, 'SKILL.md'));
  add('node', 'runtime\\primary-runtime\\dependencies\\node\\bin\\node.exe', join(runtime, 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'));
  add('bin', 'runtime\\bin\\node.exe', join(runtime, 'bin', 'node.exe'), true);
  add('cli', 'runtime\\cli\\command-manager.js', join(runtime, 'cli', 'command-manager.js'), true);
  // 容错补丁在不在位：不在位时，下次更新窗口期还会「一启动就崩」；在位则缺 SKILL.md 只是 warn。
  const officeLib = join(res, 'app', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-skill-office', 'lib', 'index.js');
  let guardOk = false;
  try { guardOk = readFileSync(officeLib, 'utf8').includes('[dsh-guard] skill-office'); } catch {}
  items.push({ id: 'guard', label: 'dsh-skill-office 容错补丁（缺 SKILL.md 不致命）', path: officeLib, ok: guardOk, size: 0, optional: true });
  const missing = items.filter((i) => !i.ok && !i.optional);
  let pendingInstaller = null;
  const pendingDir = join(process.env.LOCALAPPDATA || '', '@deepseek-aidsh-desktop-updater', 'pending');
  try { for (const f of readdirSync(pendingDir)) if (/\.exe$/i.test(f)) pendingInstaller = join(pendingDir, f); } catch {}
  let runtimeEntries = 0;
  try { runtimeEntries = readdirSync(runtime).length; } catch {}
  const runtimeBirth = birthOf(runtime);
  const age = runtimeBirth ? Math.max(0, Math.round((Date.now() - runtimeBirth) / 60000)) : -1;
  let state, advice;
  if (!missing.length) { state = 'ok'; advice = '载荷齐全，可以正常启动；刚才崩过就直接启动一次（本工具 runtime --launch），不会自己恢复。'; }
  // 更新器只换了 resources 顶层、runtime 整段没铺（或被杀软/清理工具清空）：等是等不来的，只能回填。
  else if (runtimeEntries === 0) { state = 'empty'; advice = `runtime 目录是空的（更新器没把这一段铺进来，不是「还差几项」）—— 等多久都不会自己出现。用 runtime --restore 从更新器缓存的安装包里回填 resources\\runtime\\*（不必整包重装）；没有缓存包才重装。`; }
  else if (age >= 0 && age <= 30) { state = 'window'; advice = `runtime 目录 ${age} 分钟前刚建，载荷还差 ${missing.length} 项 —— 这是更新窗口期，别反复点图标；等铺完再启动一条命令：runtime --wait 300 --launch（本机实测铺了 17 分钟）。`; }
  else if (pendingInstaller) { state = 'pending'; advice = `有已下载但没装完的更新包：${pendingInstaller}；运行它（加 /S 静默）或等下次退出时自动装。`; }
  else { state = 'broken'; advice = 'runtime 载荷缺失且不新 —— 安装不完整，用同版本安装包覆盖安装（不动 profile）。'; }
  return { root, res, runtime, items, missing, pendingInstaller, runtimeBirth, ageMinutes: age, runtimeEntries, state, advice };
}

function printRuntime(r) {
  say(bold('DSH 安装载荷体检（族 O / 族 J′）'));
  say(`安装目录：${r.root}`);
  say(`runtime  ：${r.runtime}`);
  if (r.runtimeBirth) say(`           建于 ${new Date(r.runtimeBirth).toLocaleString('zh-CN', { hour12: false })}（${r.ageMinutes} 分钟前）`);
  say(rule());
  const note = (i) => (i.ok ? '' : i.optional ? (i.id === 'guard' ? '（建议补：node patch-skill-office.cjs）' : '（可选，缺了不影响启动）') : '  ← 缺失');
  for (const i of r.items) say(`  ${i.ok ? OK : i.optional ? WARN : BAD} ${i.label}${note(i)}`);
  say(rule());
  const title = { ok: '载荷齐全', empty: '族 O 变体 · runtime 整段没铺（空目录）', window: '族 O · 更新窗口期载荷未铺完', pending: '族 O 变体 · 更新包已下载未安装', broken: '族 J′ · 安装不完整' }[r.state] || r.state;
  const tone = r.state === 'ok' ? green : r.state === 'broken' || r.state === 'empty' ? red : yellow;
  say(`判定：${tone(title)}`);
  say(`下一步：${r.advice}`);
  if (r.pendingInstaller) say(dim(`安装包：${r.pendingInstaller}`));
}

const SEVENZIP_CANDIDATES = [
  join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe'),
  join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip', '7z.exe'),
  'C:\\Program Files\\NVIDIA Corporation\\NVIDIA App\\7z.exe',
];

function find7z(explicit) {
  const cands = [explicit, process.env.DSH_DIAG_7Z];
  const w = spawnSync('where', ['7z.exe'], { encoding: 'utf8' });
  if (w.status === 0) for (const l of String(w.stdout || '').split(/\\r?\\n/)) if (l.trim()) cands.push(l.trim());
  cands.push(...SEVENZIP_CANDIDATES);
  for (const c of cands) { if (c && existsSync(c)) return c; }
  return null;
}

function countFiles(dir, cap = 100000) {
  let n = 0;
  const walk = (d) => {
    if (n >= cap) return;
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (n >= cap) return;
      if (e.isDirectory()) walk(join(d, e.name));
      else n += 1;
    }
  };
  walk(dir);
  return n;
}

/** 从更新器缓存里的安装包回填 resources\\runtime\\*（2026-10-30 现场验证过的同一招，做成命令）。 */
function cmdRuntimeRestore(argv, root) {
  const fromArg = (argv.find((a) => a.startsWith('--from=')) || '').slice(7)
    || (argv.indexOf('--from') >= 0 ? argv[argv.indexOf('--from') + 1] || '' : '');
  const zArg = (argv.find((a) => a.startsWith('--7z=')) || '').slice(5)
    || (argv.indexOf('--7z') >= 0 ? argv[argv.indexOf('--7z') + 1] || '' : '');
  let pkg = fromArg || checkRuntime(root).pendingInstaller;
  if (pkg && !/^[a-zA-Z]:[\\/]|^\\\\|^\\/.test(pkg)) pkg = join(process.cwd(), pkg);

  say(bold('回填 resources\\runtime\\（族 O 空目录）'));
  say(`安装目录：${root}`);
  if (!pkg || !existsSync(pkg)) {
    say(`${BAD} 找不到更新器缓存里的安装包（用 --from 指定一个 .exe）`);
    return 2;
  }
  say(`安装包  ：${pkg}`);
  const z = find7z(zArg);
  if (!z) {
    say(`${BAD} 找不到 7-Zip（7z.exe）。三条路：① 装 7-Zip；② 用 --7z 指向已有的 7z.exe；③ 手动两步：`);
    say(dim(`  7z x -tNsis "${pkg}" -o<临时目录> $PLUGINSDIR/app-64.7z -y`));
    say(dim(`  7z x <临时目录>\\$PLUGINSDIR\\app-64.7z -o<临时目录2> resources/runtime -y`));
    say(dim(`  再把 <临时目录2>\\resources\\runtime 整个拷回 ${join(root, 'resources')}`));
    return 2;
  }
  say(`7-Zip   ：${z}`);
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-rt-'));
  const tmp2 = mkdtempSync(join(tmpdir(), 'dsh-rt-out-'));
  const t0 = Date.now();
  try {
    say('第 1 步 / 2：从安装包（NSIS）里取出 app-64.7z …');
    const a = spawnSync(z, ['x', '-tNsis', pkg, `-o${tmp}`, '$PLUGINSDIR/app-64.7z', '-y'], { encoding: 'utf8' });
    const inner = join(tmp, '$PLUGINSDIR', 'app-64.7z');
    if (a.status !== 0 || !existsSync(inner)) {
      say(`${BAD} 第 1 步失败（exit ${a.status}）：${(a.stderr || a.stdout || '').split(/\\r?\\n/).filter(Boolean).slice(-2).join(' / ')}`);
      return 2;
    }
    say(`            已取出 app-64.7z（${Math.round(statSync(inner).size / 1048576)} MB）`);
    say('第 2 步 / 2：只解 resources\\runtime，其余不动 …');
    const b = spawnSync(z, ['x', inner, `-o${tmp2}`, 'resources/runtime', '-y'], { encoding: 'utf8' });
    const src = join(tmp2, 'resources', 'runtime');
    if (b.status !== 0 || !existsSync(src)) {
      say(`${BAD} 第 2 步失败（exit ${b.status}）：${(b.stderr || b.stdout || '').split(/\\r?\\n/).filter(Boolean).slice(-2).join(' / ')}`);
      return 2;
    }
    const n = countFiles(src);
    const need = OFFICE_SKILLS.filter((k) => existsSync(join(src, 'office-skills', k, 'SKILL.md'))).length;
    say(`            解出 ${n} 个文件；校验 SKILL.md ${need}/7，versions.json ${existsSync(join(src, 'versions.json')) ? '有' : '缺'}`);
    if (!n || need < 7 || !existsSync(join(src, 'versions.json'))) {
      say(`${BAD} 解出来的载荷不完整，不写回（安装包可能不是同一版本）`);
      return 2;
    }
    const dst = join(root, 'resources', 'runtime');
    say(`写回：${dst}`);
    cpSync(src, dst, { recursive: true, force: true });
    const after = checkRuntime(root);
    say(`${after.missing.length ? WARN : OK} 完成：${countFiles(dst)} 个文件，缺项 ${after.missing.length}（耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s）`);
    if (!after.missing.length) say(dim('接着：runtime --launch 直接拉起应用 —— 铺完不会自己起来。'));
    return after.missing.length ? 1 : 0;
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    try { rmSync(tmp2, { recursive: true, force: true }); } catch {}
  }
}

async function cmdRuntime(argv) {
  const rootIdx = argv.indexOf('--root');
  const rootArg = (argv.find((a) => a.startsWith('--root=')) || '').slice(7) || (rootIdx >= 0 ? argv[rootIdx + 1] || '' : '');
  const root = rootArg ? (/^[a-zA-Z]:[\\/]|^\\\\|^\//.test(rootArg) ? rootArg : join(process.cwd(), rootArg)) : INSTALL_DEFAULT;
  const waitIdx = argv.indexOf('--wait');
  const waitSec = Number((argv.find((a) => a.startsWith('--wait=')) || '').slice(7) || (waitIdx >= 0 ? argv[waitIdx + 1] : 0)) || 0;
  if (argv.includes('--restore')) return cmdRuntimeRestore(argv, root);
  const asJson = argv.includes('--json');
  const launch = argv.includes('--launch');
  const deadline = Date.now() + waitSec * 1000;
  let r = checkRuntime(root);
  while (waitSec && r.missing.length && Date.now() < deadline) {
    if (process.stdout.isTTY && !asJson) process.stdout.write(`\r等待载荷… 还差 ${r.missing.length} 项，剩 ${Math.round((deadline - Date.now()) / 1000)}s   `);
    await new Promise((res) => setTimeout(res, 3000));
    r = checkRuntime(root);
  }
  if (waitSec && process.stdout.isTTY && !asJson) process.stdout.write(`\r${' '.repeat(60)}\r`);
  if (asJson) say(JSON.stringify({ root: r.root, runtime: r.runtime, state: r.state, advice: r.advice, ageMinutes: r.ageMinutes, missing: r.missing.map((m) => m.path), pendingInstaller: r.pendingInstaller }, null, 2));
  else printRuntime(r);
  if (launch) {
    if (r.missing.length) { say(`
${BAD} 载荷还差 ${r.missing.length} 项，现在启动照样崩（族 O / 族 J′）；先补齐再启动。`); return 1; }
    const exe = join(r.root, 'DeepSeek Harness.exe');
    if (!existsSync(exe)) { say(`
${BAD} 找不到 ${exe}；安装目录可能不对（用 --root 指定）。`); return 2; }
    try {
      const child = spawn(exe, [], { cwd: r.root, detached: true, stdio: 'ignore' });
      child.unref();
      say(`
${OK} 已拉起 ${basename(exe)}（pid ${child.pid ?? '?'}，detached，本进程可以退出）`);
      return 0;
    } catch (e) { say(`
${BAD} 拉起失败：${e.message}`); return 2; }
  }
  return r.missing.length ? 1 : 0;
}

const HELP = `
${bold('DSH Doctor')} ${VERSION} —— DSH 弹窗报错一站式诊断（原 5 个工具合成一个入口）

用法： ${PROG} <子命令> [参数]
      双击 ${PROG}（不带参数）= 进入菜单，按 1 就是一键检查并自动修复

  ${cyan('fix')}                   一键自检 + 自动修（有备份、可回滚）＝ 菜单里的 1
        --root <路径>          指定 DSH 安装目录
        --quiet                少啰嗦

  ${cyan('menu')}                  打开菜单（双击时自动进入）

  ${cyan('version')}               打印版本号

  ${cyan('doctor')}                体检 = profile/锁 + 最新日志判族 + 网络快检（默认子命令）
        --json                 机器可读
        --full                 网络测 3 个目标（默认只测 api.deepseek.com）

  ${cyan('logs')}                  读崩溃日志并判族
        --list                 列出全部日志，每份一行结论
        --all                  解析最新一份 + 附全部概览
        <路径>                 解析指定 log

  ${cyan('net')}                   把 fetch failed 拆成 DNS/TCP/TLS/HTTP 四层
        [url ...]              默认测 api.deepseek.com / baidu / npm
        --json                 机器可读

  ${cyan('lock')}                  只看 profile 目录、lock、写权限、ACL DENY（不改）

  ${cyan('sessions')}              扫会话日志里的 turn/end reason=null（会让 host 加载即崩）
        --fix                  原地改成 {"kind":"aborted"}，原件留 *.dshfix.bak
        --json                 机器可读

  ${cyan('runtime')}               体检安装载荷：resources\\runtime 是否铺完（族 O / 族 J′）
        --wait <秒>            轮询到铺完为止（更新窗口期用，本机实测铺了 17 分钟）
        --launch               体检（含 --wait）通过后拉起应用 —— 铺完不等于能起，必须有人重启一次
        --restore              从更新器缓存的安装包里只回填 resources\\runtime\\*（空目录／没铺完时不重装）
        --from <安装包.exe>    --restore 用哪个包（默认取 @deepseek-aidsh-desktop-updater\\pending）
        --7z <7z.exe>          指定 7-Zip（默认自动找 PATH / 7-Zip 安装目录 / NVIDIA App 自带）
        --root <路径>          指定安装目录（默认 %LOCALAPPDATA%\\Programs\\DeepSeek Harness）
        --json                 机器可读

  ${cyan('fix-lock')}              调 PowerShell 修 profile ACL（族 I / EPERM）
        --apply                真修（默认只演练 -DryRun）
        --kill                 先结束 DSH 进程

  ${cyan('help')}                  这段帮助

退出码：0 正常 ｜ 1 发现问题 ｜ 2 参数或环境错误
日志目录：${logsDir()}
`;

// ───────────────────────────── 小白入口：双击就进来 ─────────────────────────────

function readLine(prompt) {
  process.stdout.write(prompt);
  const buf = Buffer.alloc(512);
  try {
    const n = readSync(0, buf, 0, buf.length, null);
    if (!n) return null;
    return buf.slice(0, n).toString('utf8').trim();
  } catch {
    return null;
  }
}

function bigTitle(text) {
  const line = '─'.repeat(Math.max(12, Math.min(60, text.length * 2 + 6)));
  say('');
  say(cyan(line));
  say(cyan('  ' + text));
  say(cyan(line));
  say('');
}

/** 一键自检 + 自动修：只做有备份、可回滚的动作。 */
async function cmdAuto(argv) {
  const root = (() => {
    const i = argv.indexOf('--root');
    return i >= 0 && argv[i + 1] ? argv[i + 1] : INSTALL_DEFAULT;
  })();
  const quiet = argv.includes('--quiet');
  const done = [];
  const todo = [];
  let bad = 0;

  if (!quiet) bigTitle(`DSH Doctor ${VERSION} · 一键自检`);
  say(`第 1 步 / 4　个人配置与锁`);
  let pr = checkProfile();
  if (pr.writable === false || (pr.lock.exists && pr.lock.isDir)) {
    const ps1 = findRepairScript();
    if (ps1) {
      say(`  · 发现问题：配置目录被锁或不可写 → 尝试自动修复`);
      const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Apply'], { encoding: 'utf8' });
      pr = checkProfile();
      if (pr.writable === false || (pr.lock.exists && pr.lock.isDir)) {
        say(`  ${BAD} 自动修复没成功（${r.status === 0 ? '脚本返回 0 但状态未变' : 'exit ' + r.status}）`);
        todo.push('把 repair-dsh-profile-lock.ps1 放到本程序同目录，再运行一次');
        bad += 1;
      } else {
        say(`  ${OK} 已修好（原状态已记录，脚本自带回滚步骤）`);
        done.push('解开了配置目录的锁');
      }
    } else {
      say(`  ${WARN} 配置目录被锁，但同目录没有 repair-dsh-profile-lock.ps1，跳过`);
      todo.push('下载 repair-dsh-profile-lock.ps1 放在本程序旁边，再运行一次');
      bad += 1;
    }
  } else {
    say(`  ${OK} 正常`);
  }

  say(`第 2 步 / 4　会话数据（启动崩的最常见原因）`);
  if (typeof zlib.zstdDecompressSync !== 'function') {
    say(`  ${WARN} 这个 Node 没有 zstd 支持，跳过`);
  } else {
    const scan = scanSessions();
    if (!scan.hits.length) {
      say(`  ${OK} 正常（${scan.files} 份会话，${scan.events} 条 turn/end，耗时 ${scan.ms}ms）`);
    } else {
      const repaired = repairSessions(scan);
      say(`  ${OK} 发现并修好 ${repaired.length} 处坏数据（原件另存 *.dshfix.bak，可回滚）`);
      done.push(`修好 ${repaired.length} 份会话里的坏 turn/end`);
    }
  }

  say(`第 3 步 / 4　安装文件是否齐全`);
  let rt = checkRuntime(root);
  if (rt.state === 'empty') {
    say(`  · 发现安装目录里 runtime 整段是空的 → 尝试从更新包回填`);
    const code = cmdRuntimeRestore([], root);
    rt = checkRuntime(root);
    if (code === 0 && !rt.missing.length) {
      say(`  ${OK} 已回填（${countFiles(join(root, 'resources', 'runtime'))} 个文件）`);
      done.push('把缺失的安装文件补齐了');
    } else {
      say(`  ${BAD} 回填没完成，见上面的提示`);
      todo.push('按上面的三条命令手动回填，或重装 DSH（会话数据不会丢）');
      bad += 1;
    }
  } else if (rt.missing.length && rt.ageMinutes <= 30) {
    say(`  · 目录是 ${rt.ageMinutes} 分钟前刚建的，还差 ${rt.missing.length} 项 → 等它铺完（最多 3 分钟）`);
    const code = cmdRuntime(['--wait', '180', '--root', root]);
    rt = checkRuntime(root);
    if (!rt.missing.length) {
      say(`  ${OK} 已铺完`);
      done.push('等安装文件铺完了');
    } else {
      say(`  ${BAD} 还在缺 ${rt.missing.length} 项`);
      todo.push('再运行一次，或等几分钟后再试');
      bad += 1;
    }
    void code;
  } else if (rt.missing.length) {
    say(`  ${BAD} 缺 ${rt.missing.length} 项：`);
    rt.missing.slice(0, 6).forEach((m) => say(`      · ${m}`));
    todo.push('运行 runtime --restore 回填，或重装 DSH');
    bad += 1;
  } else {
    say(`  ${OK} 齐全（${rt.items.filter((i) => i.ok).length}/${rt.items.length} 项）`);
  }

  say(`第 4 步 / 4　最近一次崩溃的原因`);
  const logs = listLogs(logsDir());
  const latest = logs.find((l) => /host\.log$/i.test(l.file)) || logs[0];
  if (!latest) {
    say(`  ${WARN} 没找到崩溃日志（说明没崩过，这是好事）`);
  } else {
    const a = analyzeLog(latest.file);
    say(`  · ${a.family}`);
    if (a.next) say(`    ${a.next}`);
  }

  say('');
  say(rule('━'));
  if (!bad) {
    say(`  ${OK} 体检通过${done.length ? '，并且已自动处理 ' + done.length + ' 处问题' : ''}`);
  } else {
    say(`  ${WARN} 还有 ${bad} 处需要人工处理`);
  }
  if (done.length) say(`  我做了：${done.map((d, i) => `${i + 1}. ${d}`).join('　')}`);
  if (todo.length) say(`  你需要：${todo.map((d, i) => `${i + 1}. ${d}`).join('　')}`);
  say(`  下一步：重新打开 DSH。它不会自己回来 —— 双击图标就行。`);
  say(rule('━'));
  return bad ? 1 : 0;
}

async function cmdMenu() {
  for (;;) {
    console.clear?.();
    say('');
    say(cyan('  ────────────────────────────────────────────'));
    say(cyan(`   DSH Doctor ${VERSION}`) + '    修 DSH 打不开 / 弹窗报错');
    say(cyan('  ────────────────────────────────────────────'));
    say('');
    say('   1  一键检查并自动修复（推荐，先按这个）');
    say('   2  只检查，什么都不改');
    say('   3  修好后启动 DSH');
    say('   4  打开日志文件夹');
    say('   5  更多命令（doctor / logs / sessions / runtime 等）');
    say('   0  退出');
    say('');
    const ans = readLine('  请输入数字后回车：');
    if (ans === null) return 0;
    switch (ans.trim()) {
      case '1': {
        const code = await cmdAuto([]);
        if (code === 0) {
          const go = readLine('\n  现在启动 DSH 吗？(y/N) ');
          if (go && /^y/i.test(go)) await cmdRuntime(['--launch']);
        }
        readLine('\n  按回车返回菜单…');
        break;
      }
      case '2': {
        await cmdDoctor([]);
        readLine('\n  按回车返回菜单…');
        break;
      }
      case '3': {
        await cmdRuntime(['--launch']);
        readLine('\n  按回车返回菜单…');
        break;
      }
      case '4': {
        spawnSync('explorer', [logsDir()], { stdio: 'ignore' });
        break;
      }
      case '5': {
        say(HELP);
        readLine('\n  按回车返回菜单…');
        break;
      }
      case '0': case '':
        return 0;
      default:
        say('  没看懂，请输入 1–5 或 0');
        readLine('  按回车继续…');
    }
  }
}


/** 双击运行时停一下，别让窗口一闪而过；管道/脚本调用时不停。 */
function pauseIfTTY() {
  if (!process.stdin.isTTY) return;
  spawnSync('cmd', ['/c', 'pause'], { stdio: 'inherit' });
}

async function main() {
  // 普通 node 调用：argv = [node, script, ...args]
  // SEA 打包后的 exe：argv = [exe, exe?, ...args] —— 用扩展名判断，再滤掉 exe 自身路径
  const looksLikeScript = /\.(c|m)?js$/i.test(process.argv[1] || '');
  const rest0 = process.argv.slice(looksLikeScript ? 2 : 1).filter((a) => a !== process.execPath);
  const [cmd = 'doctor', ...rest] = rest0;
  // 双击（无参数、真控制台）直接进菜单 —— 小白只需要会按 1
  if (!rest0.length && process.stdin.isTTY) return await cmdMenu();
  switch (cmd) {
    case 'version': case '--version': case '-V': say(`DSH Doctor ${VERSION}`); return 0;
    case 'fix': case 'auto': return await cmdAuto(rest);
    case 'menu': return await cmdMenu();
    case 'doctor': {
      const code = await cmdDoctor(rest);
      if (!rest0.length) pauseIfTTY();
      return code;
    }
    case 'logs': return cmdLogs(rest);
    case 'net': {
      const asJson = rest.includes('--json');
      const urls = rest.filter((a) => !a.startsWith('--'));
      const targets = urls.length ? urls : ['https://api.deepseek.com/', 'https://www.baidu.com/', 'https://registry.npmjs.org/'];
      const rep = await runNet(targets, { json: asJson });
      return rep.targets.filter((t) => t.fatal || !t.http?.ok).length ? 1 : 0;
    }
    case 'lock': { const pr = checkProfile(); printProfile(pr); return (pr.writable === false || (pr.lock.exists && pr.lock.isDir)) ? 1 : 0; }
    case 'sessions': case 'poison': return cmdSessions(rest);
    case 'runtime': case 'install': return await cmdRuntime(rest);
    case 'fix-lock': return cmdFixLock(rest);
    case 'help': case '-h': case '--help': say(HELP); return 0;
    default:
      say(`${BAD} 未知子命令：${cmd}`); say(HELP); return 2;
  }
}

main().then((code) => process.exit(code ?? 0)).catch((e) => { say(`${BAD} ${e.stack || e.message}`); process.exit(2); });
