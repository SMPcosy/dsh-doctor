import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGuardPatch, revertGuardPatch, resolveInstallRoot, looksLikeInstall } from './dsh-diag.mjs';

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
  assert.ok(lines[anchorAt + 1].includes('[dsh-guard] host capture begin'), '护栏要紧跟在锚点行后面');
  assert.ok(lines[anchorAt + 2].startsWith('\t\ttry {'), '缩进要跟锚点一致');
  assert.ok(a.src.includes('no-ready-'), '要有 60s 无 ready 的留证');
  assert.ok(a.src.includes('readyResolve'), '要包 readyResolve 记时间');

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
