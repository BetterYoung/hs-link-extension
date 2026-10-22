# 小合·易联

[简体中文](README.md) | [English](README.en.md)

小合·易联是一个无需本地服务的 Chrome/Edge Manifest V3 扩展。工具栏弹窗用于选择租户和人员并生成、复制、打开 HS 访问链接；设置页用于维护租户、人员及备份资料。

人员的查询条件支持人员 ID、工号、手机号、邮箱四种维度，由扩展在生成链接时自动匹配。

[![CI](https://github.com/BetterYoung/hs-link-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/BetterYoung/hs-link-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

当前版本：**1.4.3**（变更记录见 [CHANGELOG.md](./CHANGELOG.md)）

## 目录结构

```text
app/                      扩展源码工程（Vite + React）
  src/                    PopupApp / App / PeopleView / model / openapi / tenantOps / config
  tests/                  单元测试（node --test）
  public/                 manifest.json 与图标（会被复制进扩展目录）
  design/                 品牌主图等设计素材，不进入扩展产物
  dist/client/            可直接加载的扩展目录（当前为 1.4.3 构建产物）
docs/                     架构说明（模块职责、数据模型、调用链与不变量）
```

## 安装

### ZIP 安装（推荐分发方式）

1. 打开对应浏览器的扩展管理页并开启“开发者模式”。
2. 点击“加载已解压的扩展”。
3. 从 [Releases 页面](https://github.com/BetterYoung/hs-link-extension/releases) 下载最新的 `hs-link-vX.Y.Z.zip`，解压后选择解压出的扩展文件夹。
4. 固定“小合·易联”到浏览器工具栏。

所选目录中应直接包含 `manifest.json`，不要选择 ZIP 文件本身。

Windows 和 macOS 的操作相同；Chrome 和 Edge 的操作也相同。

### 源码加载（开发调试）

在 `app` 目录执行 `npm install && npm run build`，然后在扩展管理页加载 `app/dist/client`。

## 使用

> 工具栏弹窗右上角提供“批量新增”入口，可搜索并选择一个或多个租户后快捷添加人员，无需进入设置页。

### 1. 首次维护租户

1. 点击浏览器工具栏中的“小合·易联”图标打开弹窗。
2. 点击弹窗右上角的设置按钮，进入租户和人员管理页。
3. 点击左侧“新增租户”，填写租户名称、部署方式、API 基础地址、接入账号和接入密码。企业 ID 可以留空。
4. SaaS 部署的 API 基础地址由扩展自动预填，通常无需修改；本地化部署请填写实际的 HTTPS 地址。
5. 点击“保存”。企业 ID 留空时，扩展会调用 `/api/openapi/v1/auth/getAccessToken`，从授权响应中自动获取并回填 `corporationId`。
6. 保存后，可在左侧切换租户；右侧用于查看、编辑或删除当前租户资料。

> 新增租户时可点击“从 cURL 导入”，粘贴包含 `--url` 和 `--data` 的 `getAccessToken` 命令。扩展会自动填充访问地址、`appKey` 和 `appSecurity`，同时设置部署方式：SaaS 入口地址 为 SaaS，其他地址为本地化。扩展不会保存 Cookie 或请求头。

> 接入密码会以明文保存在当前浏览器的 `chrome.storage.local` 中，但在管理页默认遮蔽。请勿在公共电脑上保存正式环境凭据。

### 2. 维护人员

1. 在管理页左侧选择人员所属租户。
2. 在右侧“人员管理”区域点击“新增人员”。
3. 确认弹窗首行显示的租户正确。该字段由当前租户自动带入，不能编辑。
4. 填写人员姓名，并在人员 ID、工号、手机号、邮箱中至少填写一项。姓名可以留空。
5. 点击“保存”。姓名为空时，扩展会调用 `/api/openapi/v1/staffs/getStaffIds` 匹配员工，并把响应中的 `name` 自动回填到姓名；人员 ID、工号、手机号和邮箱中的空白项也会一并补齐。
6. 可通过姓名、人员 ID、工号、手机号或邮箱搜索人员，并可继续编辑或删除人员档案。

> 同一租户内的人员按人员 ID（`staffId`）去重。新增或保存已存在的人员 ID 时会更新原记录，不会产生第二条；历史重复记录会在读取或保存时自动去重，并保留最后一条。

> 租户管理标题栏提供“批量新增人员”。租户默认全选，可展开按租户名称搜索并勾选指定租户；保存时会向已选租户新增或更新同一条人员档案。姓名为空时分别使用各租户凭证匹配员工，匹配失败的租户会自动跳过，完成后显示成功和未匹配租户名单。

### 3. 生成和使用链接

1. 返回浏览器工具栏，重新打开“小合·易联”弹窗。
2. 打开“租户”下拉列表后可按租户名称搜索；点击“人员”字段展开列表，可直接输入姓名搜索并选择人员。
3. 点击“生成链接”。扩展默认生成 Web 首页、7 天有效、可重复访问的链接。
4. 生成成功后，可点击“复制链接”发送给对应人员，或点击“打开链接”在新标签页中访问。

> 未填写人员 ID 时，扩展会按工号、手机号、邮箱的顺序查询员工，任一条件命中即停止；查询结果不唯一会提示核对。

> 首次调用某个 HTTPS 域名时，浏览器会显示域名访问授权。允许后扩展才会继续调用 OpenAPI；
> 切换租户或人员后，当前生成结果会被清空，需要为新选择重新生成；
> OpenAPI token 和生成过的链接均不会持久化保存。

## 备份与换机

> [!WARNING]
>
> 备份文件含有明文接入密码，请按密码文件管理，不要上传到公开网盘、聊天群或版本库。ZIP 包本身不包含任何租户资料或凭据。

### 旧电脑：导出资料

1. 打开“小合·易联”设置页，在左侧底部点击“导入 / 导出”。
2. 选择“导出 JSON”，确认明文凭据风险后保存备份文件。
3. 备份包含全部租户、人员（含邮箱）、接入账号及明文密码，不包含 OpenAPI token 或历史访问链接。

### 新电脑：安装 ZIP 并导入资料

1. 完成 [安装](#安装)。
2. 点击工具栏中的“小合·易联”，进入设置页左侧底部的“导入 / 导出”。
3. 选择旧电脑导出的 JSON 文件。扩展会校验文件并预览租户、人员数量。
4. 确认“整体替换”，完成后检查租户和人员资料是否正确。
5. 首次生成链接时，按浏览器提示授权对应 API 域名，然后即可继续使用。

## 开发

```bash
cd app
npm install
npm test        # 单元测试
npm run build   # 产出 app/dist/client
```

结构说明与调用链见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；提交规范见 [CONTRIBUTING.md](CONTRIBUTING.md)；行为约定见 [app/AGENTS.md](app/AGENTS.md)。

## 安全约定

- 源码、测试与文档中不得写入真实租户凭据（`appKey` / `appSecurity` / 接入密码）。
- 导出的备份 JSON 含明文密码，禁止提交到版本库或公开渠道（`.gitignore` 已按文件名忽略）。
- 扩展不自带服务端，租户资料只保存在浏览器本地。

> 安全问题反馈请走 [SECURITY.md](SECURITY.md) 的私密通道，不要在 Issue 中提交。

## 参与贡献

欢迎提 Issue 与 Pull Request，详见 [CONTRIBUTING.md](CONTRIBUTING.md)；社区行为准则见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

- `main` 已开启分支保护：需 1 个他人审批、CI 通过、对话已解决才能合并；
- **发版不需要写权限**：改好版本号与 CHANGELOG、提 PR 合入 `main`，GitHub Actions 会自动打包、打标签并创建 Release——fork 贡献者同样适用；
- 详细步骤见 [CONTRIBUTING.md](CONTRIBUTING.md#发版流程)；
- 结构与调用链见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，行为约定见 [app/AGENTS.md](app/AGENTS.md)。

## 许可证

[MIT](LICENSE) © hs-link contributors
