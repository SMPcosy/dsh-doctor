#!/usr/bin/env node
/**
 * tools/mkcjs.mjs —— 把 dsh-diag.mjs（ESM）转成 build/dsh-diag.cjs（CJS），给 SEA 打包用。
 *
 * 为什么不用「逐行字符串替换」：v0.5.0 就是这样挂的 —— 源码里的 import 行加了两个名字，
 * 替换表没跟上，MISS 之后 ESM 的 import 留在 CJS 里，打出来的 exe 一启动就语法错。
 *
 * 所以这里两道闸：
 *  1) 按语法形状替换后，先查残留（行首 import / import.meta / 任意位置的 export / 顶层 await）；
 *  2) 再让 node 自己 --check 产物 —— 闸门认的是「Node 说它能跑」，不是「我以为我换干净了」。
 * 任何一道不过就删掉产物、非零退出：坏包出不了门。
 *
 * 用法：node tools/mkcjs.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'dsh-diag.mjs');
const OUT = join(ROOT, 'build', 'dsh-diag.cjs');

let s = readFileSync(SRC, 'utf8');

s = s
  .replace(/^#!.*$/mu, '// generated from dsh-diag.mjs for SEA packaging (CJS)')
  .replace(/^import\s*\{([^}]*)\}\s*from\s*'node:([^']+)';?\s*$/gmu, (_, names, mod) => `const {${names}} = require('node:${mod}');`)
  .replace(/^import\s+(\w+)\s*from\s*'node:([^']+)';?\s*$/gmu, (_, name, mod) => `const ${name} = require('node:${mod}');`)
  .replace(/^const SELF_DIR = dirname\(fileURLToPath\(import\.meta\.url\)\);\s*$/mu, 'const SELF_DIR = __dirname;')
  .replace(/^export\s*\{([^}]*)\};?\s*$/gmu, (_, names) => `module.exports = {${names}};`);

// ── 闸 1：残留扫描（宁可不出包，也别出一个一启动就崩的 exe）
const problems = [];
const leftImport = s.match(/^import\s.*$/gmu) || [];
const leftExport = s.match(/^\s*export\s/gmu) || [];
const leftMeta = s.match(/import\.meta/g) || [];
if (leftImport.length) problems.push(`残留 import：${leftImport.join(' | ')}`);
if (leftExport.length) problems.push(`残留 export（default/const/function 都要换掉）：${leftExport.map((x) => x.trim()).join(' | ')}`);
if (leftMeta.length) problems.push(`残留 import.meta ×${leftMeta.length}`);
if (/^await\s/mu.test(s)) problems.push('顶层 await（SEA 的 main 是 CJS，不能有）');
// 多条 module.exports 语法合法但会静默覆盖导出面（审计 2026-11-03 观察项）
const nExports = (s.match(/^module\.exports\s*=/gmu) || []).length;
if (nExports > 1) problems.push(`产物里有 ${nExports} 条 module.exports（后一条会盖掉前一条）`);
if (problems.length) {
  console.error('mkcjs 失败：\n  ' + problems.join('\n  '));
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, s, 'utf8');

// ── 闸 2：产物兜底 —— 交给 node --check，它说不过关就删产物
const chk = spawnSync(process.execPath, ['--check', OUT], { encoding: 'utf8' });
if (chk.status !== 0) {
  try { unlinkSync(OUT); } catch { /* 删不掉也不影响非零退出 */ }
  console.error('mkcjs 失败：产物语法不过关，已删除 build/dsh-diag.cjs');
  console.error((chk.stderr || chk.stdout || '').trim());
  process.exit(1);
}

console.log(`build/dsh-diag.cjs ${s.length} bytes（import 0 / export 0 / import.meta 0，node --check 通过）`);
