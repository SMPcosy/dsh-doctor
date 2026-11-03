// 把 SEA blob 注入 Node 22 壳，产出 build/DSH-doctor.exe。
// postject 不随本仓库分发；用它的 API（而不是 CLI），路径由 POSTJECT_API 指定。
// 用法：POSTJECT_API=/path/to/postject-pkg/package/dist/api.js node tools/inject.cjs
const fs = require('fs');

const postjectApi = process.env.POSTJECT_API;
if (!postjectApi) {
  console.error('缺 POSTJECT_API：指向 postject-pkg/package/dist/api.js（见 README「打包四步」）');
  process.exit(2);
}

const { inject } = require(postjectApi);

(async () => {
  const blob = fs.readFileSync('build/sea.blob');
  await inject('build/DSH-doctor.exe', 'NODE_SEA_BLOB', blob, {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  });
  console.log('injected, size', fs.statSync('build/DSH-doctor.exe').size);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
