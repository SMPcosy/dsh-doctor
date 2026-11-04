import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGuardPatch, revertGuardPatch, resolveInstallRoot, looksLikeInstall, guardVersionOf } from './dsh-diag.mjs';

const SAMPLE = [
  '\tconstructor() {',
  '\t\tthis.stderr = "";',
  '\t}',
  '\tstart() {',
  '\t\tconst child = spawn(this.node, ["x"]);',
  '\t\tthis.child = child;',
  '\t\tchild.stdout?.pipe(process.stdout);',
  '\t\treturn new Promise(() => {});',
  '\t}',
].join('\n');

test('护栏：插入在锚点行之后，撤销后逐字节还原', () => {
  const a = applyGuardPatch(SAMPLE);
  assert.equal(a.ok, true);
  assert.equal(a.changed, true);
  const lines = a.src.split('\n');
  const anchorAt = lines.findIndex((l) => l.includes('child.stdout?.pipe(process.stdout);'));
  assert.ok(lines[anchorAt + 1].includes('[dsh-guard v2] host capture begin'), '护栏要紧跟在锚点行后面，且标记带版本号');
  assert.ok(lines[anchorAt + 2].startsWith('\t\ttry {'), '缩进要跟锚点一致');
  assert.ok(a.src.includes('no-ready-'), '要有 60s 无 ready 的留证');
  assert.ok(a.src.includes('readyResolve'), '要包 readyResolve 记时间');
  // 回归：ready 之后必须停表。旧版只在 child 变了/到点才清，host 慢启动一次就留下假 no-ready 文件。
  assert.ok(
    /this\.readyResolve = \(v\) => \{[^\n]*clearInterval\(gwatch\)/u.test(a.src),
    'ready 到达时要 clearInterval，否则每次启动都会多一份 no-ready 误报',
  );
  assert.ok(a.src.includes('child.exitCode !== null'), 'host 已退出就别再写 no-ready');

  const b = applyGuardPatch(a.src);
  assert.equal(b.changed, false, '重复打要幂等');

  const r = revertGuardPatch(a.src);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(r.src, SAMPLE, '撤销要还原成原样');
});

test('护栏：锚点没了就明确报错，不乱写', () => {
  const res = applyGuardPatch('const x = 1;\n');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'anchor-missing');
  assert.equal(res.src, undefined);
});

test('护栏：没装时撤销是空操作', () => {
  const r = revertGuardPatch(SAMPLE);
  assert.equal(r.ok, true);
  assert.equal(r.changed, false);
  assert.equal(r.src, SAMPLE);
});

test('护栏：0.6.3 的旧版护栏要被升级，不是「已在位」跳过', () => {
  // 0.6.3 写下的正是这样一段：标记不带版本、ready 路径没有 clearInterval。
  const legacy = [
    '\tstart() {',
    '\t\tconst child = spawn(this.node, ["x"]);',
    '\t\tthis.child = child;',
    '\t\tchild.stdout?.pipe(process.stdout);',
    '\t\t/* [dsh-guard] host capture begin */',
    '\t\ttry {',
    '\t\t  let gwatch = null;',
    '\t\t  gwatch = setInterval(() => {}, 2000);',
    '\t\t} catch (e) {}',
    '\t\t/* [dsh-guard] host capture end */',
    '\t\treturn new Promise(() => {});',
    '\t}',
  ].join('\n');
  assert.equal(guardVersionOf(legacy), 1);
  const res = applyGuardPatch(legacy);
  assert.equal(res.changed, true, '旧版必须被替换，不能返回 changed:false');
  assert.equal(res.upgraded, true);
  assert.equal(res.from, 1);
  assert.equal((res.src.match(/host capture begin/gu) || []).length, 1, '不能留下两份护栏');
  assert.ok(!res.src.includes('[dsh-guard] host capture begin'), '旧标记要被清掉');
  assert.equal(guardVersionOf(res.src), 2);
  assert.ok(/this\.readyResolve = \(v\) => \{[^\n]*clearInterval\(gwatch\)/u.test(res.src), '升级后要带 ready-clear');
  const again = applyGuardPatch(res.src);
  assert.equal(again.changed, false, 'v2 之后再打才是幂等');
});

test('安装目录：--root 优先，相对路径按 cwd 补全', () => {
  const abs = resolveInstallRoot(['--root', 'D:\\Apps\\DSH']);
  assert.equal(abs.root, 'D:\\Apps\\DSH');
  assert.equal(abs.via, '--root');
  const eq = resolveInstallRoot(['--root=E:\\X\\DSH']);
  assert.equal(eq.root, 'E:\\X\\DSH');
  const rel = resolveInstallRoot(['--root', 'somewhere']);
  assert.equal(rel.via, '--root');
  assert.ok(rel.root.endsWith('somewhere'));
  assert.ok(!looksLikeInstall('C:\\definitely-not-here'), '不存在的目录不能算安装目录');
});
