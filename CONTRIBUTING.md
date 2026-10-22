# 贡献指南

感谢你参与小合·易联。本项目是**无需本地服务**的 Chrome/Edge Manifest V3 扩展：工具栏弹窗负责生成、复制和打开 HS 访问链接，设置页负责维护租户、人员与备份资料。

## 开发环境

- Node.js ≥ 20（开发使用 22）
- Chrome 或 Edge（用于加载扩展）

```bash
git clone https://github.com/BetterYoung/hs-link-extension.git
cd hs-link/app
npm install
npm test        # 单元测试（node --test）
npm run build   # 产出 app/dist/client
```

在浏览器扩展管理页开启「开发者模式」，选择「加载已解压的扩展」，指向 `app/dist/client` 即可本地调试。

接手前建议先读 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)（模块职责、数据模型、调用链与不变量）与 `app/AGENTS.md`（行为约定）。

> `app/dist/client` 是**随仓库提交**的构建产物，CI 会校验它与源码一致：改完源码请一并重新构建并提交。

## 目录结构

```text
app/
  src/
    PopupApp.jsx   工具栏弹窗：租户/人员选择、生成、复制、打开链接
    App.jsx        设置页：租户、人员、批量新增、导入导出
    PeopleView.jsx 人员列表：分页、搜索、邮箱列
    model.js       数据模型：校验、存储、备份解析、人员补齐
    openapi.js     OpenAPI 调用：授权、员工匹配、cURL 解析
    tenantOps.js   按人员 ID 去重、跨租户批量解析（不依赖 React）
  tests/           单元测试
  public/          manifest.json 与图标
  dist/client/     可加载的扩展产物
release/           发布目录与分发包
```

## 提交前请确认

- `npm test` 全部通过；
- `npm run build` 后 `app/dist/client` 无未提交差异；
- 未提交任何真实租户凭据（`appKey` / `appSecurity` / 接入密码）、备份 JSON 或访问链接；
- 界面文案与错误提示使用中文，术语与现有代码保持一致；
- 新增行为在 `app/tests` 补充用例。

## 提交信息

使用简洁的动词开头描述变更，例如：

- `修复：人员 ID 重复时保留最后一条`
- `新增：cURL 导入租户配置`
- `重构：抽出 tenantOps 以便单元测试`

## 分支与 Pull Request

1. 从 `main` 切出特性分支（如 `feature/xxx`）；
2. 保持一次 PR 只做一件事；
3. PR 描述中写明：改了什么、为什么、怎么验证，并勾选 PR 模板中的检查项；
4. `main` 已开启分支保护：**需要 1 个他人审批、CI 通过、全部对话已解决，且分支已与 `main` 同步**才能合并；禁止直推与强推；
5. CI 通过后合并。仓库管理员不受强制约束，可在紧急修复时直推。
6. 外部协作者可先 fork 仓库、在自己的分支上开发，再向上游提 PR；**合入 `main` 并改好版本号后即自动发版**，无需被添加为协作者。

## 发版流程

> **任何人都能发版，不需要 write 权限。** 规则很简单：把版本号改对、写好 CHANGELOG、提 PR 合入 `main` —— GitHub Actions 会自动完成打包、打标签、创建 Release 并上传分发包。fork 贡献者也一样：合入后自动发布。

### 1. 谁来发

- 你可以是 fork 贡献者、外部协作者或管理员，**都不影响发布**：发布由 GitHub Actions 在 `main` 上执行，不需要你的账号有写权限。
- 你不需要 `gh` CLI，不需要本地打包命令。
- 唯一的要求：改动**通过 PR 合入 `main`**（`main` 已开启分支保护：需 1 个他人审批 + CI 通过 + 对话解决）。

### 2. 改动内容（PR 里必须做）

| 文件 | 怎么改 |
| --- | --- |
| `app/public/manifest.json` | `version` 改为新版本号 |
| `app/package.json` | `version` 改为同一个版本号 |
| `app/package-lock.json` | 不用手工改，CI 与发布流程会自动同步 |
| `CHANGELOG.md` | 顶部加一节 `## X.Y.Z - YYYY-MM-DD`，面向使用者描述变更点 |
| `app/src/**`、`app/tests/**` | 功能改动；新行为必须补用例 |
| `app/dist/client/**` | 跑 `npm run build` 后一并提交（CI 会校验与源码一致） |

版本号语义：修复用 patch（1.4.3 → 1.4.4），新增功能用 minor（1.4.x → 1.5.0），破坏兼容用 major。
版本号必须**大于**已发布版本，不能回退。

### 3. 合并后自动发生什么

```text
PR 合入 main
   → CI（测试 + 构建 + 产物一致性 + 版本号一致性）通过
   → Release 工作流启动
   → 版本号已存在？        → 跳过（幂等，不会重复发版）
   → 版本号不大于已发布？  → 拒绝（防止回退发版）
   → 否则：测试 → 构建 → 打包 release/hs-link-vX.Y.Z/ 与 .zip
           → 创建标签 vX.Y.Z
           → 创建 GitHub Release 并上传 ZIP
```

发布者无需任何手工操作；Release 页面会出现 `vX.Y.Z` 与可下载的 `hs-link-vX.Y.Z.zip`。

### 4. 手工兜底（可选）

需要重发或补发时，由**有写权限的人**触发：

```bash
# 方式一：Actions 页面手动触发（输入版本号，留空则取 manifest.json）
#   仓库 → Actions → Release → Run workflow

# 方式二：本地命令
git tag -a vX.Y.Z -m "X.Y.Z：变更摘要"
git push origin vX.Y.Z
gh release create vX.Y.Z "release/hs-link-vX.Y.Z.zip" --title "vX.Y.Z" --notes-file CHANGELOG.md
```

### 5. 分发方式

- **唯一分发渠道是 GitHub Releases**：用户下载 ZIP，解压后在 `chrome://extensions` 开启开发者模式、加载解压目录。
- 分发包统一在 GitHub Releases 发布，**不纳入仓库**。
- ZIP 内 `manifest.json` 位于**根目录**；包内不含任何租户资料或凭据。
- 本项目没有应用商店上架流程，也不涉及签名密钥。

## CI 排错

| 失败的检查项 | 原因 | 处理 |
| --- | --- | --- |
| `单元测试` | 用例失败 | 本地 `npm test` 复现并修复 |
| `构建扩展` | 源码存在语法或引用错误 | 本地 `npm run build` 复现 |
| `校验构建产物与仓库一致` | 改了源码但没提交构建产物 | 执行 `npm run build` 并提交 `app/dist/client` |
| `校验发布包与 manifest 版本一致` | 改了版本号但没重新打包 | 按第 5 步重新打包并提交 |

## 行为约定（改动前请先读 `app/AGENTS.md`）

- 凭据只保存在 `chrome.storage.local`，界面默认遮蔽，不引入主密码或加密方案；
- 人员维度为 人员 ID / 工号 / 手机号 / 邮箱，缺项时按该顺序查询并只补空白；
- 同一租户内人员按人员 ID 去重，保存已存在的记录时更新该条并保留其记录 ID；
- 生成的链接与 token 不持久化；
- 备份导出包含明文密码，导入整体替换前必须校验并确认。

## 报告问题

普通问题请用 Issue 模板；**安全漏洞请勿在 Issue 中提交**，请按 [SECURITY.md](SECURITY.md) 的私密通道反馈。