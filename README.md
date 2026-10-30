# DSH Doctor · DSH 弹窗报错诊断

DSH（DeepSeek Harness）打不开、一启动就弹「无法使用」时，双击这个 exe、按一下 `1`，它自己找出原因，并把能修的部分修好。

[English](#english) ｜ [下载最新版](../../releases/latest) ｜ [报告问题](../../issues)

- **是什么**：一个 85 MB 的单文件 Windows 小程序，读本机日志、修本机文件，不联网、不上传、不需要装 Node。
- **给谁**：装过 DSH、遇到过弹窗、但不想读日志的人。
- **不是什么**：不是 DSH 插件，不改变 DSH 的功能；DSH 能正常打开之后的问题它不管。

> **0.5.1 测试版。** 它认的是 DSH **现在**的内部结构——会话事件的 `turn/end` 字段、`resources\runtime` 的目录布局、插件包放在哪。DSH 每升一次版本，这些都可能变，届时某些判读会失准（拿不准时它只报告、不动手）。遇到问题请开 Issue，附上 DSH 版本和 `DSH-doctor.exe doctor --json` 的输出。

## 目录

- [它修什么](#它修什么)
- [下载与使用（手把手）](#下载与使用手把手)
- [菜单](#菜单)
- [命令行（可选）](#命令行可选)
- [常见问题](#常见问题)
- [边界与已知限制](#边界与已知限制)
- [发布到 GitHub](#发布到-github)
- [开发过程](#开发过程)
- [参考](#参考)
- [许可](#许可)
- [English](#english)

## 它修什么

| 你看到的 | 真正的原因 | 它做什么 |
| --- | --- | --- |
| 弹窗一闪就没了 / 一直转圈起不来 | 配置目录被锁或不可写（`EPERM`） | 调 `repair-dsh-profile-lock.ps1 -Apply` 修权限 |
| 弹窗里有一堆栈，含 `reading 'kind'` | 会话日志里有旧的 `turn/end` 缺 `reason`，新版读它就崩 | 就地改写成合法值，原件留 `*.dshfix.bak` |
| 弹窗含 `ENOENT … office-skills … SKILL.md` | 更新后 `resources` 里的运行时文件整段没铺 | 从本机更新器缓存的安装包里只回填这一段（实测 17 秒 / 6150 文件） |
| 说不清是什么 | —— | 读最新一份崩溃日志，直接告诉你属于哪一类、下一步做什么 |
| 只是 `ERR_CONNECTION_REFUSED` | 启动竞态，等两秒就好 | 明确告诉你这是无害的，不让你白折腾 |

每修一处都留备份，改完可以人工回退。

## 下载与使用（手把手）

**第 0 步 · 前提**：Windows 10 / 11（64 位）；这台机器上装过 DSH。没装过 DSH 就没有可修的东西。

**第 1 步 · 下载**：打开本仓库的 [Releases](../../releases/latest) 页，点 `DSH-doctor.exe`（约 85 MB），存到桌面。

**第 2 步 · 解压**：如果下到的是 `.zip`，右键 →「全部解压缩」；如果下到的直接是 `.exe`，跳过这步。**不要**在压缩包里直接双击。

**第 3 步 · 放一个固定位置**：建议 `D:\Tools\DSH-doctor\`。

- 把 `repair-dsh-profile-lock.ps1` 也放进同一个文件夹（修配置目录权限要用它；没有也能跑，只是这一步会跳过）。
- 不要放 `C:\Program Files\`，那里需要管理员权限。

**第 4 步 · 双击运行**：Windows 会弹一个蓝色的「已保护你的电脑」——

1. 点**更多信息**
2. 点**仍要运行**

这是因为它没有买代码签名证书（个人项目常见），不是中毒。想自查可以比对 SHA256，见 [发布到 GitHub](#发布到-github)。

**第 5 步 · 按 `1`**：出现菜单后按数字 `1`，回车。它会依次检查并修四样东西，全程不问你问题。

**第 6 步 · 等它跑完**：一般 10 秒内；如果它在回填安装文件，最多 3 分钟（会显示进度）。

**第 7 步 · 看最后三行**：

```
  ✔ 体检通过，并且已自动处理 2 处问题
  我做了：1. 解开了配置目录的锁　2. 修好 1 份会话里的坏 turn/end
  下一步：重新打开 DSH。它不会自己回来 —— 双击图标就行。
```

**第 8 步 · 重启 DSH**：菜单按 `3`（修好后启动 DSH），或自己从开始菜单打开。

还是打不开？把菜单按 `2` 得到的检查结果（或 `DSH-doctor.exe doctor --json` 的输出）贴到 [Issues](../../issues)，注意先删掉里面的个人路径。

## 菜单

| 按键 | 做什么 |
| --- | --- |
| `1` | 一键检查并自动修复（推荐，先按这个） |
| `2` | 只检查，什么都不改 |
| `3` | 修好后启动 DSH |
| `4` | 打开日志文件夹（要自己看的时候用） |
| `5` | 更多命令（doctor / logs / sessions / runtime 等） |
| `0` | 退出 |

## 命令行（可选）

习惯命令行的可以跳过菜单：

| 子命令 | 做什么 | 常用参数 |
| --- | --- | --- |
| `fix` | 等同菜单 `1`：锁 / 会话 / 安装文件 / 最近崩溃，只做有备份的动作 | `--root`、`--quiet` |
| `doctor`（默认） | 五段体检：配置与锁、最新崩溃、网络、会话数据、安装文件 | `--json`、`--full` |
| `logs` | 读 `crash-*.log` 并判类 | `--list`、`--all`、`<路径>` |
| `sessions` | 扫会话里会让 DSH 崩的 `turn/end` 缺 `reason` | `--fix`、`--json` |
| `runtime` | 查 `resources\runtime` 载荷是否齐全 | `--wait <秒>`、`--launch`、`--restore`、`--root` |
| `net` | 把 `fetch failed` 拆成代理 / DNS / TCP / TLS / HTTP 四层 | `[url]`、`--json` |
| `lock` | 只看配置目录、锁残留、写权限（不改任何东西） | — |
| `fix-lock` | 修配置目录权限（要 `repair-dsh-profile-lock.ps1` 同目录） | `--apply`、`--kill` |
| `menu` / `version` / `help` | 菜单 / 版本号 / 帮助 | — |

退出码：`0` 正常，`1` 发现问题，`2` 参数或环境错误。

## 常见问题

**双击没反应，或窗口一闪就关**

说明它没拿到控制台就退出了。打开「开始菜单 → Windows PowerShell」，`cd` 到 exe 所在目录，运行 `.\DSH-doctor.exe doctor`，就能看到它到底报了什么。

**提示「Windows 已保护你的电脑」，但没有「仍要运行」**

文件被 Windows 标记为「来自网络」。右键 exe → 属性 → 勾选底部的「解除锁定」→ 确定，再双击。

**按了 `1`，还是打不开 DSH**

菜单按 `2` 把检查结果存下来（或 `DSH-doctor.exe doctor --json > result.txt`），把最后 20 行贴到 Issues。贴之前先删掉里面的 `C:\Users\<你的名字>`。

**会不会删掉我的会话或代码**

不会。它只动四类东西，每处都留 `.bak` 备份：配置目录的 ACL、会话里坏掉的那一行 `turn/end`、缺失的 `resources\runtime` 文件、以及 `dsh-skill-office` 的容错补丁。

**需要联网吗**

不需要。`runtime --restore` 用的是本机更新器缓存里的安装包。

## 边界与已知限制

- **跨版本不保证**。判定规则是按 `0.2.1-rc.3` 到 `0.2.1-rc.5` 的真实日志写的；DSH 换大版本后可能出现「认不出」的情况——这时它会老老实实说「未归类」，不会硬猜。
- **版本号语义**：`0.x` 一律是测试版，`1.0` 才承诺跨 DSH 版本可用。`0.5.1` 做的是把「测试版」写进界面和文档，并补齐菜单与说明，不是功能大改。
- **只管启动阶段**。DSH 打开之后某个功能不好用、某个插件报错，不在范围内。
- **仅 Windows x64**，Win10 1809 及以上。没有 macOS / Linux 版。
- **未签名**，SmartScreen 必然提示。要消掉得自己买证书签。
- `sessions --fix` 修的是**历史数据**，不阻止新数据产生（防新数据要靠 DSH 内核侧的空值保护）。
- `runtime --restore` 需要本机还留着更新器缓存的安装包；找不到会打印三条手动命令，不会瞎改。
- `fix-lock` 改的是 ACL，默认只演练，加 `--apply` 才真改；需要 PowerShell 5.1+。
- 会对 `dsh-skill-office` 打一个容错补丁（缺 SKILL.md 时降级而不崩），**每次 DSH 升级都会被覆盖**，升级后重跑 `patch-skill-office.cjs`。
- 除上述备份与改写外，不碰会话内容、不碰配置内容、不联网、不上传。

## 发布到 GitHub

**发了什么**

| 位置 | 内容 |
| --- | --- |
| 仓库 | 源码 `dsh-diag.mjs`、`repair-dsh-profile-lock.ps1`、`README.md`、`.gitignore` |
| Release `v0.5.1` 资产（当前版本，测试版） | `DSH-doctor.exe`（85,776,896 B）、`repair-dsh-profile-lock.ps1`（7,741 B） |

`SHA256(DSH-doctor.exe) = eae4cfe7e07b1636dac6e03fbc4d626794aff74d6a874256df59d2734a36a0e2`

自查：`certutil -hashfile DSH-doctor.exe SHA256`

`v0.5.0` 已下线：`0.5.1` 是修打包链之后的重新构建，两者行为不同，留着旧资产会让人下到跑不起来的版本。旧 tag 一并删除（`gh release delete v0.5.0 --cleanup-tag`）。

**怎么发的**

1. exe 不进 git（`.gitignore` 挡 `*.exe`、`build/`、`*.bak`），走 Release 资产——单个 exe 80 MB 以上，提交进仓库会让每个 clone 都拖一遍。
2. 先建私有仓库确认内容，再改可见性：`gh repo edit <name> --visibility public --accept-visibility-change-consequences`。
3. 打标签并发版：`gh release create v0.5.1 DSH-doctor.exe repair-dsh-profile-lock.ps1 --title "DSH Doctor 0.5.1 (beta)" --notes-file notes.md`。
4. 发新版：改 `VERSION` → 重新打包（见下节）→ 新 tag → 上传新资产，旧 tag 保留；只有旧版**行为已经不对**（比如这次打包链有 bug）时才下线旧版，并在说明里写清原因。

## 开发过程

**技术选型**

- 单个 ESM 文件 `dsh-diag.mjs`，零第三方依赖，只用 Node 内置模块（`fs`、`zlib`、`child_process`、`readline`）。
- 打包成单文件 exe：Node 22 的 SEA（Single Executable Application）+ postject 注入 blob。

**为什么不用 Node 24**

本机 24.21.0 上，SEA + postject 注入后启动即 `0xC0000005`（bash 里 exit 139）。用最小样例 `console.log("hi")` 复现，同样崩；抹 PE 证书表、关 code cache、省略 sentinel fuse 都无效。换 22.20.0 后一次通过。

**打包四步**

```bash
# 1) ESM → CJS（SEA 的 main 必须是 CommonJS：import 改 require、SELF_DIR 改 __dirname）
node mkcjs.js                      # 生成 build/dsh-diag.cjs

# 2) 生成 SEA blob
node.exe --experimental-sea-config build/sea-config-22.json

# 3) 拷 Node 22 当壳并注入
cp node22/node.exe build/new.exe
node postject-pkg/package/dist/api.js   # inject(): build/new.exe + NODE_SEA_BLOB + sentinel fuse

# 4) 冒烟
./build/new.exe help && ./build/new.exe runtime && ./build/new.exe logs --list
```

**调试方式**

- 先跑源码再打包：`node dsh-diag.mjs <子命令>`，改一行就能验。
- 判断「是不是打包坏了」：同一份代码在 Node 24 上崩、Node 22 上正常，就是壳的问题，不是逻辑的问题。
- 判类规则靠真实日志回归：每遇到一种新弹窗，先把 `crash-*.log` 加进回归集，再改 `verdict()`。

**结构**

`main()` 解析子命令 → `cmdDoctor` / `cmdAuto` / `cmdLogs` / `cmdSessions` / `cmdRuntime` / `cmdNet` / `cmdLock`；判类集中在 `verdict()` 与 `analyzeLog()`，两者是唯一事实源。

## 参考

- [Node.js · Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) —— 单文件打包的官方口径
- [nodejs/postject](https://github.com/nodejs/postject) —— 往 exe 里注入 blob 的工具（本项目用它的 API 而非 CLI）
- [RichardLitt/standard-readme](https://github.com/RichardLitt/standard-readme) —— 本 README 的章节顺序参照
- [ddbeck/readme-checklist](https://github.com/ddbeck/readme-checklist) —— 「识别 / 评估 / 使用 / 参与」四轴结构
- [7-Zip](https://www.7-zip.org/) —— `runtime --restore` 用它解 NSIS 安装包里的 `app-64.7z`
- 同类思路：Sysinternals 系列工具「一个 exe、免安装、只读本机」的做法，本项目沿用。

## 许可

本项目由 [@SMPcosy](https://github.com/SMPcosy) 维护。问题、建议、新的崩溃样本都欢迎开 Issue。

当前仓库**未声明许可证**，即保留所有权利（可下载、可自用，不可再分发或商用）。若要开源，从这里选一个再补 `LICENSE`：[MIT](https://choosealicense.com/licenses/mit/) ｜ [Apache-2.0](https://choosealicense.com/licenses/apache-2.0/)。

---

## English

**DSH Doctor** fixes the most common *DeepSeek Harness won't start* failures on Windows: it reads the local crash log, repairs the profile lock, rewrites poisoned `turn/end` events, and restores a missing `resources\runtime` payload — then tells you what to do next.

Single 85 MB exe. No installer, no Node.js, no admin rights, no network calls.

**Quick start**

1. Download `DSH-doctor.exe` from [Releases](../../releases/latest). Put it in a normal folder (e.g. `D:\Tools\DSH-doctor\`), together with `repair-dsh-profile-lock.ps1` if you want the ACL repair step.
2. Double-click it. SmartScreen says "Windows protected your PC" — click **More info → Run anyway** (the binary is unsigned).
3. Press `1`. It runs four checks and repairs what it can, keeping a `*.bak` copy of everything it touches.
4. Read the last three lines, then reopen DSH (menu `3` launches it for you).

**What it does**

| Symptom | Cause | Action |
| --- | --- | --- |
| Crash loop, `EPERM` | profile directory locked | repair ACLs via bundled PowerShell script |
| Stack contains `reading 'kind'` | old `turn/end` events without `reason` | rewrite in place, keep `.dshfix.bak` |
| `ENOENT … office-skills … SKILL.md` | runtime payload missing after update | restore only `resources\runtime` from the cached installer |
| Unknown | — | classify the newest crash log and print next steps |

**Limits**

- Startup-stage problems only; Windows x64 only; unsigned binary.
- `sessions --fix` repairs historical data; it does not prevent new bad events.
- `runtime --restore` needs the updater's cached installer on this machine.
- The optional `dsh-skill-office` guard patch is overwritten by every DSH upgrade.

**Release**

Repository: source + PowerShell helper + this README. Release `v0.5.1` (beta) assets: `DSH-doctor.exe` (85,776,896 B, `SHA256 eae4cfe7e07b1636dac6e03fbc4d626794aff74d6a874256df59d2734a36a0e2`) and `repair-dsh-profile-lock.ps1`. `v0.5.0` was withdrawn because its build pipeline could silently produce a broken exe. Every `0.x` is a beta — the tool reads DSH internals, so a DSH upgrade may invalidate some verdicts. Built with Node 22 SEA + postject; Node 24 segfaults on injection.

**License**

No license declared yet — all rights reserved. Pick MIT or Apache-2.0 before calling it open source.
