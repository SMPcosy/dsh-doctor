# DSH Doctor · DSH 弹窗报错诊断

## 先说三件事

### 一、为什么一运行就弹「未知程序」

因为这个 exe 没有代码签名证书。Windows 判断一个从网上下载的程序可不可信，只看两样：**有没有可验证的发布者签名**、**这个文件在微软那边有没有信誉积累**。它两样都没有，所以每次都被拦：

- **文件属性里「发布者」一栏是空的。** 签名要买证书（能过 SmartScreen 的 OV / EV 证书需要企业资质和年费），个人项目通常不签；没有签名，Windows 只能显示「未知发布者」，弹窗里也会把程序名缩成你在截图里看到的那个陌生名字。
- **它带着「来自网络」的标记。** 从浏览器下载的 exe 会被写上一个 Zone.Identifier 标记；「有下载标记 + 无签名 + 无信誉」这三样凑齐，SmartScreen 第一次运行必然拦一道蓝底提示：「Windows 已保护你的电脑」。
- **每发一版都是新文件。** 哈希一变，信誉从零开始，所以不是「这一次特别可疑」，而是每个版本都会再弹一次。

这不是 DSH 的问题，也不能反过来证明它安全 —— 它就是一个没签名的普通程序。要确认手上这份是不是本仓库发的：比对 `SHA256`（见 [发布到 GitHub](#发布到-github)）。文件属性里「数字签名」空白是正常的；有你不认识的签名，才该警惕。

放行方法：蓝底提示点**更多信息 → 仍要运行**；如果没有「仍要运行」，说明文件被标了「来自网络」，右键 → 属性 → 勾选「解除锁定」→ 确定。

### 二、它是照着弹窗截图反推的方案，没有取得全部日志

- 24 族的判读规则，来自共享库对 **60 张实拍弹窗截图** 的文字归纳，**不是**完整的日志语料；本项目**没有取得 DSH 全部的 `crash-*.log` 样本**，也没有官方背书。
- 它认的是**文本指纹**：日志里出现某几句特征话，就归到某一族。措辞变了、只贴了半行，它会明说「未归类」，不硬猜一个族糊弄你。
- 指纹相同不等于根因相同。族名是「最可能」，不是「已确诊」；要定死还得看日志全文。每族的指纹、成因、处理都能自己查：`DSH-doctor.exe families P`。

### 三、运行后它先读日志，再动手

菜单 `1` 的顺序是固定的，不会一上来就改文件：

1. **先读**：取最近一份 `crash-*.log`（有 `host.log` 就优先它），判出族名并打印 —— 这一步只读，不动任何文件；
2. **再修**：然后才走四步检查与修复 —— 配置目录与锁 → 会话里坏的 `turn/end` → `resources\runtime` 是否铺齐 → 汇总；
3. **留退路**：每处改动先备份（`.bak` / `.dshfix.bak`），收尾时告诉你「我做了什么」「你还需要做什么」。

没有崩溃日志时它照跑，但只做不依赖判读的那几项，不替你猜原因。

DSH（DeepSeek Harness）打不开、一启动就弹「无法使用」时，双击这个 exe、按一下 `1`，它自己找出原因，并把能修的部分修好。

[English](#english) ｜ [下载最新版](../../releases/latest) ｜ [报告问题](../../issues)

- **是什么**：一个 85 MB 的单文件 Windows 小程序，读本机日志、修本机文件，不联网、不上传、不需要装 Node。
- **给谁**：装过 DSH、遇到过弹窗、但不想读日志的人。
- **不是什么**：不是 DSH 插件，不改变 DSH 的功能；DSH 能正常打开之后的问题它不管。

> **0.6.4 测试版。** 它认的是 DSH **现在**的内部结构——会话事件的 `turn/end` 字段、`resources\runtime` 的目录布局、插件包放在哪。DSH 每升一次版本，这些都可能变，届时某些判读会失准（拿不准时它只报告、不动手）。`0.6.0` 起它认得成体系的弹窗族谱，`0.6.2` 起共 **25 族**（A–V，含 A′ / B′ / J′），族谱来自共享库对 60 张实拍弹窗的整理 —— 不联网也能查：`DSH-doctor.exe families`。`0.6.1` 把「先判族」提到第一步（只读），并修掉大会话文件让体检报 `Invalid string length` 的问题。`0.6.3` 加了两件事：`host`（有进程、没窗口的启动体检，族 W）和 `guard`（给 desktop 的 `main.js` 装启动护栏，让「卡住」也留下证据）；安装目录改成自动发现，装在 D 盘或绿色版也能用。`0.6.4` 只修护栏：0.6.3 的计时器在主机已经 ready 之后仍会写 `no-ready-<pid>.log`，把正常启动误报成族 W。遇到问题请开 Issue，附上 DSH 版本和 `DSH-doctor.exe doctor --json` 的输出。

## 目录

- [先说三件事](#先说三件事)
- [它修什么](#它修什么)
- [它认得哪些弹窗（25 族）](#它认得哪些弹窗25-族)
- [事故档案（真实崩溃复盘）](#事故档案真实崩溃复盘)
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
| 弹窗里有 `working-directory: directory does not exist` | 会话记着的工作目录被删 / 改名 / 换盘 | 指出是哪一族，并给出找回目录或切目录的做法 |
| 说不清是什么 | —— | 读最新一份崩溃日志，直接告诉你属于哪一类（24 族）、下一步做什么 |
| 只是 `ERR_CONNECTION_REFUSED` | 启动竞态，等两秒就好 | 明确告诉你这是无害的，不让你白折腾 |

每修一处都留备份，改完可以人工回退。

## 它认得哪些弹窗（25 族）

族谱来自共享库「DSH 报错弹窗」对 60 张实拍弹窗的整理。判读靠**文本指纹**，不是猜；`logs` 直接报族名，`families` 查全表（含指纹 / 原因 / 处理）。

| 族 | 一句话 | 族 | 一句话 | 族 | 一句话 |
| --- | --- | --- | --- | --- | --- |
| A | 启动期 JSON 解析崩溃 | I | profile 目录权限被拒 | Q | 工具 schema 非法（`type: null`） |
| A′ | 启动包 `package.json` 带 BOM（desktop 起不来） | | | | |
| B | 服务链未就绪（`… is unavailable`） | J | 网络层致命错误（裸 `fetch failed`） | R | provider 路由没有凭证 |
| B′ | 服务等待表停在 UI 服务 | J′ | 安装包不完整（运行时资源没就位） | S | 代理预设注册表损坏 |
| C | 欢迎窗 RPC 失败 | K | 子进程全挂 `0xC0000142`（无弹窗） | T | 设置无法保存（数据目录不可写） |
| D | 渲染进程崩溃 | L | 双击无反应（旧实例占着单实例锁） | U | 开放平台已更新，需刷新页面 |
| E | 鉴权失败（401） | M | 欢迎窗鉴权失败（cookie 超 16KB → 431） | V | SmartScreen 拦下载（非 DSH 故障） |
| F | 模型传输失败（含 404） | N | 会话日志被 `turn/end reason=null` 毒化 | | |
| G | 提示词变量非法（`{{cwd}}`） | O | 更新窗口期 `resources\runtime` 未铺完 | | |
| H | 代理预设缺失 | P | 会话工作目录不存在 | | |

K / L / U / V 本来就不产生 DSH 崩溃日志（K 是子进程全挂、L 是双击没反应、U 是服务端版本门、V 是系统拦下载），**别指望在日志里看到它们** —— 这几族靠你描述的症状对表。

## 事故档案（真实崩溃复盘）

族 A′ 不是从截图反推的，是 2026-11-03 这台机器上真实发生过的一次启动崩溃。

**症状**：DSH 双击后完全起不来。没有窗口、没有弹窗、没有「正在加载」——只有
`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-<时间>-main.log` 里那一行：

```
SyntaxError: Unexpected token '\ufeff', "\ufeff{
  "nam"... is not valid JSON
    at main (file:///C:/…/resources/app/lib/main.js:12386:24)
```

**根因**：`resources\app\package.json` 的开头多了 3 个字节 `EF BB BF`（UTF-8 BOM）。
desktop 的 `lib/main.js` 读它时是这么写的：

```js
const manifest = JSON.parse(await readFile(join(app.getAppPath(), "package.json"), "utf8"));
```

`JSON.parse` 一碰到 BOM 立刻抛。这句在 `main()` 的最前面，抛了就没有任何界面、也没有回退路径，
所以表现成「应用打不开」而不是「弹窗报错」。写 BOM 的多半是 PowerShell 5.1 的
`Set-Content -Encoding UTF8`——它默认带 BOM，`Out-File` 和 `>` 在 5.1 里同样会写。

**为什么难认**：这台机器上其余工具链都是**读端剥 BOM**的（`replace(/^\uFEFF/, '')` 撒在好几处），
于是「写端不剥、读端剥」的错配平时不显形，只在恰好绕过剥 BOM 的那一处炸。所以 A′ 的修法不是
「改 profile 里某个 json」，而是**改应用包自己的 package.json**——这正是它必须和族 A 分开、
单独占一个族号的原因。

**处理**：
1. 去掉 BOM：`node -e "const fs=require('fs'),p=process.argv[1];fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''),'utf8')" "…\resources\app\package.json"`；
2. 根治在读端——本机已把 desktop 的 manifest 解析改成 `.replace(/^\uFEFF/, "")` 后再 `JSON.parse`，
   原文件备份为 `lib\main.js.bak-bomguard-<时间戳>`；
3. 这类改动会被 DSH 更新覆盖（`lib/main.js` 整份替换），升级后要重新确认。

**时间线**（本地时间）：

| 时刻 | 事件 |
| --- | --- |
| 2026-11-03 20:35:02 | desktop 主进程 startup 期抛 SyntaxError，应用起不来，落 `crash-…-main.log` |
| 20:35:48 | `resources\app\package.json` 被重写，BOM 被去掉（现在头字节 `7b 0d 0a`） |
| 20:36:07 | 应用重启成功 |
| 22:55:50 | 又一次整套重启——这次**不是**崩溃：无 crash 日志、Windows 事件日志无 1000/1001/1026、无 restart-request 记录 |

**判族建议**：日志里 `Unexpected token` 后面跟着一个看不见的字符，且栈指向
`resources\app\lib\main.js`，就是 A′；若是 profile 下的 json、或错误文本是 `','` / `'n'` / `null`，
则是族 A。两者修的地方不同，别混。

### 族 W：有进程、没窗口（壳等不到 host 的 ready）

**症状**：双击 DSH 之后，任务管理器里能看到 5～6 个 `DeepSeek Harness.exe`，但**没有任何窗口**，
托盘也没有，日志目录里**一份新日志都没有**。等多久都不出来；杀掉重开，有时好、有时照样没有。

**机制**（读 `resources\app\lib\main.js` 与 `dsh-desktop-host` 得到）：desktop 主进程 spawn 一个
host 子进程，然后**等它通过 IPC 发 `{type:"ready", url}`**，收到才 `createMainWindow()` 开窗。
host 发 ready 之前必须走完：建 application → 装更新/退出钩子 → `ctx.plugin(office_exports)` → 发布平台会话 →
拿 authenticated URL。**任意一道 `await` 不返回，ready 就永远不来**：壳一直等、窗口不建、进程健在。

**为什么零痕迹**：壳只在 host **非零退出**时写 `crash-*-host.log`；卡死时进程不退，所以不写。
host 的 stderr 本来只存在父进程内存里一个 64KB 的环形缓冲，连读都读不到——事后完全无法判断卡在哪。
这就是它比崩溃更难查的地方：**崩溃有日志，卡死什么都没有**。

**处理**（`0.6.3` 起有工具）：
1. `DSH-doctor.exe host` —— 列进程与窗口句柄；「有进程、没窗口」即判族 W；
2. `DSH-doctor.exe guard --apply` —— 给 `main.js` 插入护栏（自动备份、装完做语法自检，不过就还原）：
   host 的 stderr 实时落 `logs\host-<pid>.log`，**60 秒没 ready** 再写 `logs\no-ready-<pid>.log`
   （含 stderr 尾部）。重启一次生效；
3. `DSH-doctor.exe host --repair` —— 结束全部 DSH 进程后重新拉起，等窗口出现；
   本工具正跑在 DSH 里时会拒绝（会把自己一起杀掉），确认要杀就加 `--yes`；
4. 拿到 `no-ready-*.log` 之后，stderr 尾部会直接指到卡住的那一步。

**时间线**（本机 2026-11-03，本地时间）：

| 时刻 | 事件 |
| --- | --- |
| 18:47:29 | host pid 14252 起来了、插件日志齐全，但从不 ready —— 第一次「有进程没窗口」 |
| 19:26:42 | 机器重启（Kernel-Power 109，非崩溃） |
| 19:53:34 / 20:08:35 | 又两次同样卡在 ready 之前（pid 10312 / 40828） |
| 20:34:37–20:35:02 | 另一起无关故障：`package.json` 被写进 BOM，startup 崩（族 A′） |
| 20:36:04 / 20:37:48 / 20:39:40 | BOM 已修好，但这三次仍无窗口 —— 说明 A′ 与 W 是两条独立故障 |
| 20:44:39 | 无缘无故好了（磁盘零改动，推测僵尸 host 被清掉） |
| 20:48:08 | 再次卡死，直到 22:55 全杀才恢复 |

**判族建议**：**别把 W 当 A′**。A′ 有 `crash-*-main.log` 且一启动就崩；W 是「进程在、窗口不在、
日志不动」。也别信「窗口被隐藏了」去强拉窗口——窗口根本没建（`createWindow(..., show=false)` 之后要等
`backend.state.phase === "ready"` 才 `show()`），强拉只会得到白窗。

## 下载与使用（手把手）

**第 0 步 · 前提**：Windows 10 / 11（64 位）；这台机器上装过 DSH。没装过 DSH 就没有可修的东西。

**第 1 步 · 下载**：打开本仓库的 [Releases](../../releases/latest) 页，点 `DSH-doctor.exe`（约 85 MB），存到桌面。

**第 2 步 · 解压**：如果下到的是 `.zip`，右键 →「全部解压缩」；如果下到的直接是 `.exe`，跳过这步。**不要**在压缩包里直接双击。

**第 3 步 · 放一个固定位置**：建议 `D:\Tools\DSH-doctor\`。

- 把 `repair-dsh-profile-lock.ps1` 也放进同一个文件夹（修配置目录权限要用它；没有也能跑，只是这一步会跳过）。
- 不要放 `C:\Program Files\`，那里需要管理员权限。

**第 4 步 · 双击运行**：Windows 会弹一个蓝色的「已保护你的电脑」—— 点**更多信息**，再点**仍要运行**。原因写在 [为什么一运行就弹「未知程序」](#一为什么一运行就弹未知程序) 里；想确认不是被替换过的文件，比对 `SHA256`（见 [发布到 GitHub](#发布到-github)）。

**第 5 步 · 按 `1`**：出现菜单后按数字 `1`，回车。它先读最近一份崩溃日志、报出属于哪一族（只读），再依次检查并修四样东西，全程不问你问题。

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
| `1` | 一键检查并自动修复（推荐，先按这个）：先读最近日志判族，再动手修 |
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
| `logs` | 读 `crash-*.log` 并判族（25 族） | `--list`、`--all`、`<路径>` |
| `families` | 25 族对照表：指纹 / 原因 / 处理，可只看一族 | `families P`、`families "B'"`、`--json` |
| `host` | 启动体检：有进程、没窗口（族 W） | `--repair`、`--yes`、`--wait <秒>`、`--root` |
| `guard` | 给 `main.js` 装/撤启动护栏：host stderr 落盘 + 60s 无 ready 留证 | `--apply`、`--revert`、`--root` |
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

**DSH 装在 D 盘 / 改过安装路径 / 绿色版，还能用吗**

能。`0.6.3` 起安装目录改成自动发现，顺序是：`--root` → 环境变量 `DSH_INSTALL_DIR` → 正在运行的
`DeepSeek Harness.exe` 的路径 → 注册表卸载项里的 `DisplayIcon` / `InstallLocation` → 默认位置。
前四路都拿不到才回落到 `%LOCALAPPDATA%\Programs\DeepSeek Harness`，并且每次都把「目录来自哪一路」打在屏幕上，
不会闷着头改错地方。显式指定最稳：`DSH-doctor.exe runtime --root "D:\Apps\DeepSeek Harness"`。

**护栏（guard）会不会把 DSH 改坏**

不会给你一个改坏的机会：装之前原文件整份备份成 `main.js.bak-dshguard-<时间戳>`，写完立刻用 `node --check`
做语法自检，**不过就自动还原**；不放心随时 `guard --revert`。唯一的副作用是升级 DSH 会整份替换 `main.js`，
护栏跟着没了——升级后重跑一次 `guard --apply` 即可（它也认不出去时只会说「护栏没装」，不会瞎改）。

## 边界与已知限制

- **跨版本不保证**。判定规则是按 `0.2.1-rc.3` 到 `0.2.1-rc.5` 的真实日志写的；DSH 换大版本后可能出现「认不出」的情况——这时它会老老实实说「未归类」，不会硬猜。
- **判族依据不是完整日志语料**。24 族来自 60 张弹窗截图的文本归纳，本项目没有取得 DSH 全部 `crash-*.log` 样本；指纹未命中即报「未归类」，不硬套族名。
- **版本号语义**：`0.x` 一律是测试版，`1.0` 才承诺跨 DSH 版本可用。`0.6.0` 做的是把族谱从 14 族补到 24 族（新增 M / P / Q / R / S / T / U / V / K 与 B′ 的判读）、加 `families` 对照表，并把打包链与判族回归搬进仓库（`tools/mkcjs.mjs`、`verdict.test.mjs`）；`0.6.1` 把崩溃判族提到动手之前，并修掉大会话文件导致的 `Invalid string length` 崩溃；`0.6.2` 新增族 A′（启动包 `package.json` 带 BOM），族谱 24 → 25，并把这次真实事故复盘收进「事故档案」；`0.6.3` 新增 `host`（族 W：有进程、没窗口）与 `guard`（启动护栏：host stderr 落盘、60s 无 ready 留证），安装目录改为自动发现，测试 11 条（原 7 条 + 护栏 4 条）；`0.6.4` 修掉护栏的 ready 误报（已 ready 的主机不再在 60s 后写 `no-ready`），并给护栏标记加版本号——`guard --apply` 会把 0.6.3 的旧护栏自动剥掉重装，测试 12 条。
- **只管启动阶段**。DSH 打开之后某个功能不好用、某个插件报错，不在范围内。
- **仅 Windows x64**，Win10 1809 及以上。没有 macOS / Linux 版。
- **未签名**，SmartScreen 必然提示。要消掉得自己买证书签。
- **族 L（双击无反应）没有判读规则**：它不写崩溃日志，`logs` 判不出来，只能 `families L` 对照症状人工认。
- **`权限/占用类` 不算独立的族**：`EACCES` / `EBUSY` 是兜底结论，不在 24 族表里；它不指向单一根因，只说「先关占用进程 / 修权限」。
- **族 N 只认那一句**：日志里出现 `Cannot read properties of null (reading 'kind')` 就判 N，不再要求栈里有 `dsh-session-projection` —— 用户常常只贴一行。
- **`Failed to fetch` 归到族 J（网络层）**：它能是网络，也能是设置保存失败；带「设置 / 保存」上下文时先判 T，其余按网络走 `net` 分层。
- `sessions --fix` 修的是**历史数据**，不阻止新数据产生（防新数据要靠 DSH 内核侧的空值保护）。
- `runtime --restore` 需要本机还留着更新器缓存的安装包；找不到会打印三条手动命令，不会瞎改。
- `fix-lock` 改的是 ACL，默认只演练，加 `--apply` 才真改；需要 PowerShell 5.1+。
- 会对 `dsh-skill-office` 打一个容错补丁（缺 SKILL.md 时降级而不崩），**每次 DSH 升级都会被覆盖**，升级后重跑 `patch-skill-office.cjs`。
- 除上述备份与改写外，不碰会话内容、不碰配置内容、不联网、不上传。

## 发布到 GitHub

**发了什么**

| 位置 | 内容 |
| --- | --- |
| 仓库 | 源码 `dsh-diag.mjs`、`repair-dsh-profile-lock.ps1`、`verdict.test.mjs`、`guard.test.mjs`、`tools/`（`mkcjs.mjs`、`inject.cjs`、`sea-config.json`）、`README.md`、`.gitignore` |
| Release `v0.6.4` 资产（线上最新） | `DSH-doctor.exe`（85,812,224 B）、`repair-dsh-profile-lock.ps1`（7,741 B） |

`SHA256(DSH-doctor.exe) = e7f717250187d88d2334f863bf71293c6346ce28966090d64350d465a723697d`

自查：`certutil -hashfile DSH-doctor.exe SHA256`

`v0.5.0` 已下线：`0.5.1` 是修打包链之后的重新构建，两者行为不同，留着旧资产会让人下到跑不起来的版本。旧 tag 一并删除（`gh release delete v0.5.0 --cleanup-tag`）。`v0.5.1` 保留 —— 它能跑，只是族谱少一半。

**怎么发的**

1. exe 不进 git（`.gitignore` 挡 `*.exe`、`build/`、`*.bak`），走 Release 资产——单个 exe 80 MB 以上，提交进仓库会让每个 clone 都拖一遍。
2. 先建私有仓库确认内容，再改可见性：`gh repo edit <name> --visibility public --accept-visibility-change-consequences`。
3. 打标签并发版：`gh release create v0.6.4 DSH-doctor.exe repair-dsh-profile-lock.ps1 --title "DSH Doctor 0.6.4 (beta)" --notes-file notes.md`。
4. 发新版：改 `VERSION` → 重新打包（见下节）→ 新 tag → 上传新资产，旧 tag 保留；只有旧版**行为已经不对**（比如这次打包链有 bug）时才下线旧版，并在说明里写清原因。

## 开发过程

**技术选型**

- 单个 ESM 文件 `dsh-diag.mjs`，零第三方依赖，只用 Node 内置模块（`fs`、`zlib`、`child_process`、`readline`）。
- 打包成单文件 exe：Node 22 的 SEA（Single Executable Application）+ postject 注入 blob。

**为什么不用 Node 24**

本机 24.21.0 上，SEA + postject 注入后启动即 `0xC0000005`（bash 里 exit 139）。用最小样例 `console.log("hi")` 复现，同样崩；抹 PE 证书表、关 code cache、省略 sentinel fuse 都无效。换 22.20.0 后一次通过。

**打包四步**

```bash
# 0) 壳：Node 22 便携版解压出的 node.exe 放到 build/node22/
#    （https://nodejs.org/dist/v22.20.0/node-v22.20.0-win-x64.zip，只需里面的 node.exe）

# 1) ESM → CJS（SEA 的 main 必须是 CommonJS：import 改 require、SELF_DIR 改 __dirname）
node tools/mkcjs.mjs               # 生成 build/dsh-diag.cjs；残留 import/export 或 node --check 不过就退出码 1（产物删掉）

# 2) 用 Node 22 生成 SEA blob（blob 必须由壳同版本 Node 生成）
build/node22/node.exe --experimental-sea-config tools/sea-config.json   # → build/sea.blob

# 3) 拷 Node 22 当壳并注入（postject 不随仓库分发，用它的 API）
cp build/node22/node.exe build/DSH-doctor.exe
POSTJECT_API=<postject-pkg>/package/dist/api.js node tools/inject.cjs

# 4) 冒烟
./build/DSH-doctor.exe version && ./build/DSH-doctor.exe help | head -3 \
  && ./build/DSH-doctor.exe families | head -3 && ./build/DSH-doctor.exe logs --list | head -3
```

**判族回归**

```bash
node --test verdict.test.mjs      # 每族至少一条真实指纹；族名必须和 FAMILIES 对得上
```

改 `verdict()` 之前先往 `verdict.test.mjs` 加一条样本 —— 先有指纹，再有分支。打包链同理：`tools/mkcjs.mjs` 有两道闸 —— 先查残留（行首 `import`、任意位置的 `export`、`import.meta`、顶层 `await`、多条 `module.exports`），再让 `node --check` 自己验产物；任何一道不过就删产物、退出码 1，坏包出不了门（v0.5.0 就是这么烂掉的）。

**调试方式**

- 先跑源码再打包：`node dsh-diag.mjs <子命令>`，改一行就能验。
- 判断「是不是打包坏了」：同一份代码在 Node 24 上崩、Node 22 上正常，就是壳的问题，不是逻辑的问题。
- 判类规则靠真实日志回归：每遇到一种新弹窗，先把 `crash-*.log` 加进回归集，再改 `verdict()`。

**结构**

`main()` 解析子命令 → `cmdDoctor` / `cmdAuto` / `cmdLogs` / `cmdFamilies` / `cmdSessions` / `cmdRuntime` / `cmdNet` / `cmdLock`；判族集中在 `verdict()` 与 `analyzeLog()`，族谱文字在 `FAMILIES`，两者是唯一事实源，且由测试强制对齐。

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

**Read this first**

- **Why Windows calls it an unknown program.** The exe is unsigned: no publisher certificate, no SmartScreen reputation, and a brand-new hash every release. So the file properties show an empty publisher, and the first launch is blocked by "Windows protected your PC". Click **More info → Run anyway**; if that button is missing, clear the internet-download mark (right-click → Properties → Unblock). Compare the SHA256 listed under *Release* to confirm you have the real build.
- **What this project is based on.** The 24 crash families are text-fingerprint rules inferred from 60 photographed crash popups — not from a complete `crash-*.log` corpus. No full log samples were obtained, and there is no official endorsement. When no fingerprint matches, the tool reports "unclassified" instead of guessing.
- **After launch it reads first, then repairs.** Menu `1` reads the newest crash log and classifies it (read-only) before touching anything, then runs the four repair steps and keeps a `.bak` copy of every change.

**Quick start**

1. Download `DSH-doctor.exe` from [Releases](../../releases/latest). Put it in a normal folder (e.g. `D:\Tools\DSH-doctor\`), together with `repair-dsh-profile-lock.ps1` if you want the ACL repair step.
2. Double-click it. Windows says "Windows protected your PC" — click **More info → Run anyway** (unsigned binary; see *Read this first*).
3. Press `1`. It runs four checks and repairs what it can, keeping a `*.bak` copy of everything it touches.
4. Read the last three lines, then reopen DSH (menu `3` launches it for you).

**What it does**

| Symptom | Cause | Action |
| --- | --- | --- |
| Crash loop, `EPERM` | profile directory locked | repair ACLs via bundled PowerShell script |
| Stack contains `reading 'kind'` | old `turn/end` events without `reason` | rewrite in place, keep `.dshfix.bak` |
| `ENOENT … office-skills … SKILL.md` | runtime payload missing after update | restore only `resources\runtime` from the cached installer |
| Unknown | — | classify the newest crash log into one of 24 families and print next steps |

**Limits**

- Startup-stage problems only; Windows x64 only; unsigned binary.
- `sessions --fix` repairs historical data; it does not prevent new bad events.
- `runtime --restore` needs the updater's cached installer on this machine.
- The optional `dsh-skill-office` guard patch is overwritten by every DSH upgrade.

**Release**

Repository: source + PowerShell helper + tests + build script + this README. Release `v0.6.4` (beta) supersedes `v0.6.3`: same `host` / `guard` features, with the guard no longer writing a false `no-ready-<pid>.log` for a host that already reported ready. Assets: `DSH-doctor.exe` and `repair-dsh-profile-lock.ps1`. `0.6.1` classifies the newest crash before touching anything and fixes the `Invalid string length` crash on very large session files. `v0.5.0` was withdrawn because its build pipeline could silently produce a broken exe. Every `0.x` is a beta — the tool reads DSH internals, so a DSH upgrade may invalidate some verdicts. Built with Node 22 SEA + postject; Node 24 segfaults on injection.

**License**

No license declared yet — all rights reserved. Pick MIT or Apache-2.0 before calling it open source.
