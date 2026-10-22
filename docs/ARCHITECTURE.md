# 架构说明

本文描述小合·易联的**长期结构与不变量**，供维护者与协作智能体快速上手。只写当前有效的事实，不记录进度、待办与版本流水；版本变化见 [CHANGELOG.md](../CHANGELOG.md)，开发流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)，行为约定见 [app/AGENTS.md](../app/AGENTS.md)。

## 1. 形态

- Chrome/Edge **Manifest V3** 扩展，**不依赖本地服务**，直接由浏览器调用HS OpenAPI。
- 两个入口：`index.html`（设置页，`options_page`）与 `popup.html`（工具栏弹窗，`action.default_popup`）。
- `manifest.json` 权限只有 `storage`；`optional_host_permissions` 为 `https://*/*`，**按租户 API 域名在运行时逐个申请**，不预先获取全量域名权限。
- 源码在 `app/`，Vite 以两个 HTML 为入口构建到 `app/dist/client/`——**这是唯一可加载的扩展产物**，随仓库提交，CI 会校验它与源码一致。
- `app/public/` 下的文件会被原样复制进扩展目录，`app/design/` 下的设计素材不会进入产物。

## 2. 模块职责

| 文件 | 职责 |
| --- | --- |
| `app/src/model.js` | 数据模型：字段校验、租户/人员规范化、`chrome.storage.local` 读写、备份导出与解析、人员信息补齐 |
| `app/src/openapi.js` | HS OpenAPI 调用：域名授权、租户授权、员工匹配、cURL 解析、链接生成 |
| `app/src/tenantOps.js` | 按人员 ID（`staffId`）去重的 upsert、跨租户批量匹配（不依赖 React，便于单元测试） |
| `app/src/App.jsx` | 设置页：租户与人员管理、批量新增、cURL 导入、导入导出 |
| `app/src/PopupApp.jsx` | 弹窗：租户/人员可搜索下拉、批量新增、生成/复制/打开链接 |
| `app/src/PeopleView.jsx` | 人员表：每页 10 人、搜索（姓名/人员 ID/工号/手机号/邮箱）、邮箱列、编辑删除 |
| `app/tests/*.test.mjs` | `node --test` 单元测试，覆盖模型、接口、设置页、弹窗与批量逻辑 |

## 3. 数据模型

```text
workspace
├─ schemaVersion: 1
├─ tenants[]                         租户
│  ├─ id, name
│  ├─ corporationId                 企业 ID（可留空，保存时由授权响应回填）
│  ├─ baseUrl                        HTTPS 源（不含路径/账号/参数）
│  ├─ deployment: "saas" | "onPrem"
│  ├─ appKey, appSecurity            接入账号与接入密码（明文保存在本地）
│  └─ people[]                       人员
│     ├─ id, name                    name 可留空，保存前由员工匹配回填
│     └─ staffId, code, phone, email 四个维度互补，任一命中即可查询
├─ selectedTenantId
└─ selectedPersonId
```

- 本地存储键：`access-link-workspace-v1`（`chrome.storage.local`）。
- 备份格式：`hs-link-backup`，`schemaVersion: 1`；导出为 JSON 字符串，**包含明文接入密码**；导入时先校验再整体替换。
- 历史版本导出的备份使用旧格式标识，导入时按标识后缀兼容，不影响既有备份文件。
- 早期版本导出的备份（无 `email` 字段）仍可导入，`email` 视为空串。

## 4. 调用链

```text
弹窗「生成链接」
  └─ generateAccessLink(tenant, person)
       ├─ resolve origin：SaaS 且有企业 ID → GET /api/openapi/v2/location?corpId=…
       ├─ POST /api/openapi/v1/auth/getAccessToken  { appKey, appSecurity }
       ├─ 人员维度不全 → POST /api/openapi/v1/staffs/getStaffIds  { type, conditionIds }
       │     type 顺序：STAFFID → CODE → CELLPHONE → MAIL
       └─ POST /api/openapi/v1.1/provisional/getProvisionalAuth
             { uid, pageType: "frontPage", expireDate: "604800", isApplet: false }

设置页「保存租户」
  └─ authorizeTenant(tenant) → 企业 ID 留空时回填；已填且与响应不一致 → 中止保存

设置页/弹窗「保存人员」
  └─ 姓名为空 → resolveStaff(tenant, person) → 回填姓名与空白字段
       └─ upsertPerson(people, person) → 同租户内按 staffId 去重
```

要点：

- 企业 ID 与响应不一致时**中止保存**（不静默覆盖）。
- 员工查询结果不唯一或缺少姓名时**中止并提示**，不写入半成品数据。
- 生成的链接与 access token **不持久化**；只有租户/人员资料落盘。

## 5. 不变量（改动前务必确认）

1. 设置页只做租户、人员、备份管理；链接生成只在弹窗。
2. 凭据只存 `chrome.storage.local`，界面默认遮蔽；不引入主密码或加密方案。
3. 人员四维度互补；缺项时按 STAFFID → CODE → CELLPHONE → MAIL 查询，且**只补空白、不覆盖**已有值。
4. 同一租户内 `staffId` 唯一：保存已存在的 `staffId` 更新该条并**保留其记录 ID**；历史重复项在读取/保存时去重并保留最后一条。
5. 姓名为空时先匹配员工再落盘；企业 ID 为空时先授权再落盘。
6. 导入备份必须"先校验、后确认、再整体替换"。
7. 人员列表每页 10 人，搜索与切换租户后回到对应页。
8. 每次扩展调用的目标域名都需要用户授权；权限按源申请，不预取。
9. 扩展没有服务端，仓库内不出现真实凭据、备份文件或访问链接。

> 已知行为（非缺陷）：弹窗生成链接时，只要人员资料缺少 `email` 也会触发一次员工查询。若要收紧为"仅缺 `staffId` 才查询"，需作为独立版本改动并同步更新测试。

## 6. 加新功能的落点

| 想做的事 | 改哪里 |
| --- | --- |
| 新增人员维度 / 新接口 | `app/src/openapi.js`（同步 `app/src/model.js` 的字段与校验） |
| 新增数据字段 | `app/src/model.js`（校验 + 备份兼容），再改 `PeopleView.jsx` / `App.jsx` 展示 |
| 新的批量场景 | `app/src/tenantOps.js`（保持与 React 解耦，便于测试） |
| 新界面 | `app/src/App.jsx` 或 `app/src/PopupApp.jsx`，并补 `app/src/styles.css` / `popup.css` 对应类名 |
| 新校验规则 | 在 `model.js` 的 `normalize*` 中收紧，并同步补 `app/tests` 用例 |

## 7. 发布流程（要点）

**发布规则以 [CONTRIBUTING.md](../CONTRIBUTING.md) 的「发版流程」为准**，此处只列要点：

```text
PR 合入 main（改好 manifest.json / package.json 的 version，并写 CHANGELOG）
   → CI 通过
   → Release 工作流自动：测试 → 构建 → 打包 → 打标签 vX.Y.Z → 建 Release 并上传 ZIP
```

- 任何人都能发版：fork 贡献者合入 PR 后即自动发布，不需要 write 权限、不需要本地命令；
- 分发包统一在 GitHub Releases 发布，不纳入仓库。
- 工作流幂等：标签已存在则跳过；版本号不大于已发布版本则拒绝；
- 版本号必须在 `app/public/manifest.json` 与 `app/package.json` 中一致，`package-lock.json` 由流程自动同步；
- CI 会校验：`npm test` 通过、构建成功、`app/dist/client` 与源码一致、两处版本号一致。

## 8. 仓库与版本说明

- 本仓库自 1.4.3 起公开发布，仓库内容与分发包均由本仓库源码构建产生。
- 当前版本的行为与数据结构以本文和 `app/AGENTS.md` 为准。
