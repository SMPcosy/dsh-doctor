/**
 * verdict.test.mjs —— 判族回归（node --test verdict.test.mjs）
 *
 * 每个样本就是一条真实弹窗指纹（来源：共享库「DSH 报错弹窗」图库 60 张）。
 * 规则：一族至少一条；新增族时先加样本再加 verdict 分支，别反过来。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verdict, FAMILIES, selectFamilies, analyzeLog } from './dsh-diag.mjs';

const label = (msg, all = '') => verdict(msg, all)[0];

/** [族标签, 样本 message, 附加日志正文] */
const CASES = [
  ['族 A：启动期 JSON 解析崩溃', `Unexpected token ',', "..." is not valid JSON`],
  ['族 A：启动期 JSON 解析崩溃', `Unexpected token 'n', "name" is not valid JSON`],
  ["族 A′：启动包 package.json 带 BOM（desktop 起不来）", "SyntaxError: Unexpected token '\uFEFF', \"\uFEFF{ \"nam\"... is not valid JSON", "    at main (file:///C:/…/resources/app/lib/main.js:12386:24)"],
  ['族 B：服务链未就绪', 'Error: workspaceController is unavailable'],
  ['族 B：服务链未就绪', 'Error: sessionController is unavailable (service-unavailable)'],
  ['族 B：服务链未就绪', 'plugin dsh-x is unavailable: did not activate'],
  ["族 B′：服务等待表停在 UI 服务", 'pending (waiting for services: uiConversation, uiWorkspace)'],
  ['族 C：欢迎窗 RPC 失败', 'desktop welcome: Web RPC failed'],
  ['族 D：渲染进程崩溃', 'Desktop renderer exited: crashed'],
  ['族 E：鉴权失败（401）', 'HTTP 401: Authentication Fails (governor)'],
  ['族 F：模型传输失败', 'DeepSeek Messages transport failed'],
  ['族 G：提示词变量非法', 'unknown prompt variable "{{cwd}}"'],
  ['族 H：代理预设缺失', '未知的代理预设值：standard'],
  ['族 I：profile 目录权限被拒', `EPERM: operation not permitted, open 'C:\\Users\\u\\.dsh\\profiles\\desktop\\lock'`],
  ['族 J：网络层致命错误（fetch failed）', 'TypeError: fetch failed'],
  ["族 J′：安装包不完整（运行时资源没就位）", `ENOENT: no such file or directory, open 'C:\\x\\resources\\runtime\\node\\node.exe'`],
  ['族 K：子进程全挂 0xC0000142', 'spawn ENOENT — exited with 0xC0000142'],
  ['族 M：欢迎窗鉴权失败（cookie 超 16KB → 431）', 'desktop welcome: Web authentication failed'],
  ['族 N：会话日志被 turn/end reason=null 毒化', `TypeError: Cannot read properties of null (reading 'kind')`],
  ['族 N：会话日志被 turn/end reason=null 毒化',
    `TypeError: Cannot read properties of null (reading 'kind')
    at SessionProjection.materialize (C:\\x\\node_modules\\dsh-session-projection\\lib\\index.js:42:7)`],
  ["族 B′：服务等待表停在 UI 服务", 'pending (waiting for services: workspaceController, uiConversation)'],
  ['族 E：鉴权失败（401）', 'http 401 unauthorized'],
  ['族 J：网络层致命错误（fetch failed）', 'TypeError: Failed to fetch'],
  ['权限/占用类', 'EBUSY: resource busy or locked, open ".dsh/profiles/desktop/lock"'],
  ['族 O：更新窗口期 runtime 载荷未就位',
    `ENOENT: no such file or directory, open 'C:\\x\\resources\\runtime\\office-skills\\word\\SKILL.md'`],
  ['族 P：会话工作目录不存在', 'working-directory: directory does not exist: "D:\\work\\gone"'],
  ['族 Q：工具 schema 非法（type: null）',
    `Invalid schema for function 'dsh_tool_x': schema must be a JSON Schema of 'type: "object"', got type: null`],
  ['族 R：provider 路由没有凭证', 'llm-pi-ai: no credential for provider route "openai"'],
  ['族 S：代理预设注册表损坏', 'agent-preset registry broken: failed to load'],
  ['族 T：设置无法保存（数据目录不可写）', '设置保存失败：Failed to fetch，请检查数据目录是否可写'],
  ['族 U：开放平台已更新，需刷新页面', '开放平台已更新，请刷新页面后继续使用'],
  ['族 V：SmartScreen 拦下载（非 DSH 故障）', 'Windows SmartScreen：无法验证发布者'],
];

test('25 族对照表：数量、id 唯一', () => {
  assert.equal(FAMILIES.length, 25);
  assert.equal(new Set(FAMILIES.map((f) => f.id)).size, 25);
  for (const f of FAMILIES) {
    for (const k of ['id', 'name', 'finger', 'cause', 'fix']) assert.ok(f[k], `族 ${f.id} 缺 ${k}`);
    // 路径里漏写一个反斜杠 → \r 变真换行、\@ 丢反斜杠；这类文案用户照抄会失败，直接测死。
    for (const k of ['finger', 'cause', 'fix'])
      assert.ok(!/[\u0000-\u001f]/.test(f[k]), `族 ${f.id}.${k} 有控制字符（反斜杠被转义吃掉了）`);
  }
  assert.match(FAMILIES.find((f) => f.id === 'M').fix, /%APPDATA%\\@deepseek-ai/u);
  assert.match(FAMILIES.find((f) => f.id === 'O').finger, /resources\\runtime/u);
  assert.match(FAMILIES.find((f) => f.id === 'J′').finger, /resources\\runtime\\office-skills/u);
});

test('每个指纹都判到对应族', () => {
  for (const [want, msg, all] of CASES) assert.equal(label(msg, all), want, msg);
});

test('verdict 的族名与 FAMILIES 对得上（不许各写各的）', () => {
  const known = new Set(FAMILIES.map((f) => `族 ${f.id}：${f.name}`));
  const extra = new Set(['启动竞态：host 未就绪（无害）', '未归类', '权限/占用类', '族 B 变体 · profile 插件被跳过（版本不配）']);
  for (const [want] of CASES) {
    assert.ok(known.has(want) || extra.has(want), `FAMILIES 里没有：${want}`);
  }
  // 反向：表里每一族都得有办法被判出来（K/L/U/V 只靠文字兜底，L 无日志）
  const hitLabels = new Set(CASES.map(([w]) => w));
  for (const f of FAMILIES) {
    if (f.id === 'L') continue;
    assert.ok(hitLabels.has(`族 ${f.id}：${f.name}`), `族 ${f.id} 没有回归样本`);
  }
});

test('无害的启动竞态不误判成族 J', () => {
  const all = ['source: main', 'phase: running', 'net::ERR_CONNECTION_REFUSED'].join('\n');
  assert.equal(label('net::ERR_CONNECTION_REFUSED', all), '启动竞态：host 未就绪（无害）');
});

test('families 选族：带撇的挑 B′ / J′，不带的就是本体', () => {
  assert.deepEqual(selectFamilies(["B'"]).map((f) => f.id), ['B′']);
  assert.deepEqual(selectFamilies(['B']).map((f) => f.id), ['B']);
  assert.deepEqual(selectFamilies(["J'"]).map((f) => f.id), ['J′']);
  assert.deepEqual(selectFamilies(['J']).map((f) => f.id), ['J']);
  assert.equal(selectFamilies([]).length, FAMILIES.length);
  assert.equal(selectFamilies(['Z']).length, 0);
});

test('未知文本老实说未归类', () => {
  assert.equal(label('something odd happened', ''), '未归类');
});

test('analyzeLog 能从日志文件里读出族（解析器与判读同一事实源）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-doctor-'));
  try {
    const file = join(dir, 'crash-2026-11-03_04-00-00-host.log');
    writeFileSync(file, [
      'time: 2026-11-03T04:00:00.000Z',
      'source: host',
      'phase: startup',
      'app: 0.2.1-rc.5',
      '',
      '--- error ---',
      'fatal load failure: working-directory: directory does not exist: "D:\\work\\gone"',
      '',
    ].join('\n'), 'utf8');
    const a = analyzeLog(file);
    assert.equal(a.family, '族 P：会话工作目录不存在');
    assert.equal(a.header.source, 'host');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
