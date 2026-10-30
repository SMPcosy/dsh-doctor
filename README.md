# DSH Doctor

A single-file Windows tool that fixes the most common **DeepSeek Harness won't start / crash popup** problems, built for non-technical users.

**Download `DSH-doctor.exe` from [Releases](../../releases) → double-click → press `1`.**

No Node.js, no admin rights, no install. 82 MB self-contained exe (Node 22 runtime embedded). Windows SmartScreen will warn because the binary is unsigned: *More info → Run anyway*.

What `1` does (each step has a backup):

1. unlock / repair the profile directory (needs `repair-dsh-profile-lock.ps1` next to the exe)
2. rewrite poisoned `turn/end reason:null` events in `~/.dsh/sessions`
3. check `resources\runtime` payload; restore it from the cached installer package when the update left it empty
4. explain the latest crash from `crash-*.log`

CLI: `DSH-doctor.exe fix | doctor | logs --list | sessions --fix | runtime --restore | net | lock | version`.

---

# DSH Doctor · DSH 弹窗报错诊断（单文件 exe）

把原来 5 个散装工具合成一个入口 `dsh-diag.mjs`，并打成**单文件 exe**：**`DSH-doctor.exe`**（81.8 MB，内嵌 Node 22.20.0 运行时）。

**给用户就一句话：双击它，按 1。** 不需要装 Node、不需要管理员、不需要联网；拷到任何目录都能跑（实测把 PATH 剥到只剩 system32 也照常工作）。

> 23:40 注：`runtime --restore` —— 从更新器缓存里的安装包里**只回填 `resources\runtime\*`**，不必整包重装。机理（WorkBuddy 反编译 app.asar 得出、我复核过）：rc.5 更新器换掉了 `resources` 顶层，却把 `runtime` 整段留空；这个目录是启动硬依赖（host 拿 `runtime\primary-runtime`，再取同级 `office-skills` 与 `dependencies\node\bin\node.exe`），缺了必挂；跟第三方插件无关 —— 所以弹窗上的 Restart / Disable third-party plugins 都没用。
>
> 23:10 注：`runtime` 加 `--launch`（体检/等待通过后直接拉起应用）。原因：载荷铺完 ≠ 应用会自己回来 —— 10-30 那晚 21:49:46 载荷就落完了，DSH 直到 22:35:55 才起来，中间一小时是空白，更新器只重试 5 次就停手。所谓「自愈」是误判，实际是外部把它拉起来的。
>
> 22:50 注：新增 `runtime` 子命令（族 O：更新窗口期 runtime 载荷没铺完）与 `patch-skill-office.cjs` 容错补丁；exe 已重打，含 12 项载荷检查。

> 18:30 注：exe 已用 **Node 22.20.0** 重打成功（Node 24.21.0 的 SEA 注入后必段错误，见文末），现在 exe 与 `dsh-diag.mjs` 功能一致，含 `sessions` 子命令和 10-30 新加的判族规则。

## 最快的用法（小白只要看这一段）

```
双击 DSH-doctor.exe  →  出现菜单  →  按 1  （一键检查并自动修复）
```

它会依次做四件事，全程只动有备份、可回滚的东西：

1. **个人配置与锁** —— 配置目录被锁 / 不可写时，自动调 `repair-dsh-profile-lock.ps1 -Apply`（同目录存在才做）
2. **会话数据** —— 扫出会让 host 加载即崩的 `turn/end reason:null`，原地修好，原件留 `*.dshfix.bak`
3. **安装文件是否齐全** —— `resources\runtime` 整段空了就 `--restore` 从更新包里回填；刚更新完还差几项就等它铺完（最多 3 分钟）
4. **最近一次崩溃的原因** —— 直接给族别 + 下一步

跑完输出三行结论：**我做了什么 / 你需要做什么 / 下一步（重新打开 DSH）**。要直接帮你启动，菜单按 3，或在菜单 1 结束时回 `y`。

菜单里另外几项：`2` 只检查不改、`4` 打开日志文件夹、`5` 全部命令。

习惯命令行的话：

```powershell
.\DSH-doctor.exe fix            # = 菜单 1（可加 --root <安装目录> --quiet）
.\DSH-doctor.exe                # = doctor：五段体检（脚本里调用不会弹菜单）
.\DSH-doctor.exe runtime --restore   # 只回填 resources\runtime（17 秒 / 6150 文件）
.\DSH-doctor.exe sessions --fix       # 只修会话毒化
.\DSH-doctor.exe version / help
```

源码也可以直接跑：`node .\dsh-diag.mjs`（功能完全一致）。

## 发布到 GitHub

1. **走 Release assets，不要 commit 进仓库**：GitHub 单文件 100 MB 硬限制，这个 exe 81.8 MB 塞进 git 会让每个 clone 都拖 82 MB；Release 单文件上限 2 GB。
2. 一次发三个文件：`DSH-doctor.exe`、`repair-dsh-profile-lock.ps1`、`README.md`。只发 exe 也能用，但 `fix-lock` / 菜单 1 的锁修复会跳过（会明确提示）。
3. 贴 SHA256：`sha256sum DSH-doctor.exe`，让人下载后自查。
4. **未签名 → SmartScreen 会拦**（改过 node.exe 的必然结果）：README 写明「更多信息 → 仍要运行」；有证书就 `signtool sign /fd SHA256 /tr <时间戳服务器> /td SHA256 DSH-doctor.exe`。
5. 别把 `build/`（重打包材料）放进仓库；重打包四步见文末，缺 `node_modules/commander` 时用 `postject/dist/api.js` 的 `inject()` 直接注入（本仓库就是这么打的）。

## 子命令

| 子命令 | 干什么 | 常用参数 |
| --- | --- | --- |
| `fix`（菜单 1） | 一键自检 + 自动修：锁 / 会话 / 安装载荷 / 最近崩溃，只做有备份的动作 | `--root`、`--quiet` |
| `menu` | 交互菜单（双击时自动进入） | — |
| `version` | 打版本号 | — |
| `doctor`（默认） | 五段体检：profile 目录与锁、最新崩溃日志判族、网络快检、会话数据（turn/end）、安装载荷 | `--json`、`--full`（网络测 3 个目标） |
| `logs` | 读 `crash-*.log` 并判族（族 A–L + B′/J′/M/N 判据） | `--list`、`--all`、`<路径>` |
| `net` | 把 `fetch failed` 拆成 代理环境 / DNS / TCP / TLS / HTTP 四层 | `[url ...]`、`--json` |
| `sessions` | 扫 `~/.dsh/sessions` 里 `turn/end` 的 `reason: null`（rc.3 投影读到会 `reading 'kind'` 崩，族 N） | `--fix`（原地修，留 `.dshfix.bak`）、`--json` |
| `runtime` | 查 `resources\runtime` 的 12 项载荷（versions.json / 7 个 office SKILL.md / node.exe / cli / skill-office 容错补丁），按「目录刚建＝更新窗口期」判族 O | `--wait <秒>`、`--launch`、`--restore`、`--from <安装包>`、`--7z <7z.exe>`、`--root <路径>`、`--json` |
| `lock` | 只看 profile 目录、lock 残留、写权限、ACL DENY（不改任何东西） | — |
| `fix-lock` | 调 `repair-dsh-profile-lock.ps1` 修 ACL（族 I） | `--apply`（真修）、`--kill`（先杀进程） |
| `help` | 帮助 | — |

退出码：`0` 正常 ｜ `1` 发现问题 ｜ `2` 参数或环境错误。

## 与旧文件的关系

| 旧文件 | 现在 | 说明 |
| --- | --- | --- |
| `crash-log-reader.mjs` | `logs` 子命令的代码来源 | 保留，可单独跑；共享库 `_ai/scripts/` 有同内容副本 |
| `diag-fetch-failed.mjs` | `net` 子命令的代码来源 | 保留 |
| `repair-dsh-profile-lock.ps1` | `fix-lock` 调用的执行体 | 保留，ACL 逻辑不重写，避免抄错 |
| `看崩溃日志.mjs` / `.cmd` | 等价于 `logs` | 保留，老习惯仍可用 |
| `dsh-diag.mjs`（新） | 统一入口、唯一事实源 | 改代码只改它，再跑一次打包 |
| `DSH-doctor.exe`（新） | 单文件分发入口 | 零依赖，双击即可 |
| `DSH诊断.cmd`（新） | 双击入口（exe 优先） | 跑 `doctor` |

## 比旧版多做的事

- `doctor` 一次给全四段，不用分别跑四个脚本。
- 日志判族新增：`skipping profile bundle …`（不论退出码 1 还是 `0x40010004`，都归「族 B 变体 · profile 插件被跳过」，旧版全判成「未归类」）；`reading 'kind'` + `dsh-session-projection` → 族 N；`net::ERR_CONNECTION_REFUSED` + source `main|web-boot` → 启动竞态（无害，不当崩溃报）。
- `doctor` 遇到最新一份是「启动竞态」时会继续往前翻 6 份，报「最近一次真崩溃」。
- `sessions` 自己解多帧 zstd（`session.v4.jsonl.zstd` 是一帧一次 append 拼起来的），不解压到临时文件。
- 日志判族新增族 O：`office-skills` + `ENOENT` + `resources\runtime` → 「更新窗口期 runtime 载荷未就位」，不再笼统归到族 J′（「重装」往往不是这时的正确答案）。
- `runtime` 能认出「整段没铺」这种最坏情况（`empty`，红色标题「族 O 变体」），并能 `--restore` 现场修好：`7z x -tNsis <包> $PLUGINSDIR/app-64.7z` → `7z x app-64.7z resources/runtime` → 校验 7 个 SKILL.md 与 versions.json → 只覆盖 `resources\runtime`。
- `runtime` 子命令直接给出「哪个文件缺、runtime 目录建于几分钟前、有没有下好但没装的更新包」，并能 `--wait` 轮询。
- `doctor` 第 5 段顺手检查 `dsh-skill-office` 的容错补丁在不在位（不在位就提醒补，否则下次更新窗口期还会崩）。
- `lock` 自己用 `CREATE_NEW` 探针验写权限，不依赖 PowerShell。
- 管道被提前关闭（`| head`）时不再抛 EPIPE 崩掉。

## 已知边界

- `fix-lock` 依赖 PowerShell 5.1 及以上，并且需要 `repair-dsh-profile-lock.ps1` 与 exe **同目录或上级目录**（依次找 exe 目录 → 上级 → 当前目录）；`--apply` 会真的改 ACL，默认只演练。
- 网络检查会真发请求（每目标最多 8 秒，`DIAG_TIMEOUT_MS` 可调）。
- 日志里 `错误码` 是从全文抓的，可能抓到与根因无关的 `ENOENT`；以「判读 + 结论」两行为准。
- `sessions --fix` 只改 `"reason":null` → `{"kind":"aborted"}` 这一种，且留 `.dshfix.bak`；它修的是**历史数据**，不防新数据（防新数据靠内核 clamp + `dsh-member-manager` 0.4.1）。
- `runtime` 的「更新窗口期」判据是「runtime 目录创建 ≤ 30 分钟且载荷不全」，本机实测铺完要 17 分钟；超过 30 分钟还缺才是真装坏。
- `patch-skill-office.cjs` 改的是 `resources\app\dsh\node_modules\@deepseek-ai\dsh-skill-office\lib\index.js`，**每次 DSH 升级都会被覆盖**，升级后重跑 `node patch-skill-office.cjs`（幂等，`--check` 看状态，`--revert` 还原）。
- 共享库 `_ai/scripts/repair-dsh.ps1` 是另一件事（族 J′：更新后 runtime 空，重跑安装包），与本目录的 `repair-dsh-profile-lock.ps1`（族 I：ACL）互补。

## exe 是怎么打的（Node 22 才行）

用 Node 自带的 SEA（Single Executable Application），不引入 pkg/bun。**关键是壳用 Node 22.20.0**：Node 24.21.0 的 node.exe 注入后必段错误（见下节），22 LTS 一次通过。

```powershell
cd C:\work\dsh-errors\工具

# 0) 一次性准备：Node 22 的 node.exe 放 %TEMP%\node22\node.exe
#    curl -L -o %TEMP%\node22.zip https://nodejs.org/dist/v22.20.0/node-v22.20.0-win-x64.zip
#    解压出 node-v22.20.0-win-x64\node.exe 即可

# 1) ESM 源 → CJS（SEA 的 main 必须是 CommonJS：import 改 require、SELF_DIR 改 __dirname）
node "$env:TEMP\mkcjs.js"          # → build\dsh-diag.cjs；dsh-diag.mjs 仍是唯一事实源

# 2) 生成 SEA blob（build\sea-config-22.json 指向 build\dsh-diag.cjs）
$env:TEMP\node22\node.exe --experimental-sea-config .\build\sea-config-22.json   # → build\sea22.blob

# 3) 拷 Node 22 当壳，并把 blob 注入
copy "$env:TEMP\node22\node.exe" ".\DSH-doctor.exe"
node .\build\postject-pkg\package\dist\cli.js ".\DSH-doctor.exe" NODE_SEA_BLOB .\build\sea22.blob `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# 4) 冒烟
.\DSH-doctor.exe help; .\DSH-doctor.exe lock; .\DSH-doctor.exe sessions
```

- **参数顺序容易写错**：`postject <目标exe> <资源名 NODE_SEA_BLOB> <blob 路径> --sentinel-fuse <fuse 串>`。资源名和 fuse 串不是一回事。
- `build\postject-pkg\` 是解压好的 postject 1.0.0-alpha.6 + commander 9.5.0（不依赖 npm，直接 `curl` 拉 tgz 解包）。
- 注入时 postject 会警告 `The signature seems corrupted!`——改动 node.exe 的必然结果，不影响运行（代价是没有 Authenticode 签名，SmartScreen 可能提示）。
- 体积 81.8 MB（整份 node 运行时），换来目标机零依赖；重打约 20 秒（大头是复制 81 MB）。

### 为什么不能用 Node 24.21.0（2026-10-30 18:10 实测）

同一个 node 24.21.0（官方 dist 版与 DSH 运行时版字节完全相同）、同一份 postject，注入后**启动即 0xC0000005 段错误**（`exit 139`），连 `console.log("hi")` 的最小样例也一样：

- `useSnapshot: false` → 段错误；这是 CLI 唯一可用的模式（脚本在运行时跑）。
- `useSnapshot: true` → 能启动，但 Node 在**构建期**执行一遍主脚本，产物里 `main()` 已经在打包时跑过，运行时不再执行 → 不能用于命令行工具。
- 已排除：换官方 node.exe、先抹掉 PE 证书表再注入、`useCodeCache` 开/关、`--sentinel-fuse` 省略。
- Node 22.20.0 同样四步一次成功，`zlib.zstdDecompressSync` 也在（`sessions` 依赖它）。

结论：**打包壳固定 Node 22 LTS**，`dsh-diag.mjs` 本身仍可用任意 ≥22 的 node 直接跑。旧版 24 壳已挪到 `build\DSH诊断-旧版-sea24.exe`（能跑，但没有 `sessions`）。
