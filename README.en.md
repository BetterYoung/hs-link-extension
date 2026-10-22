# 小合·易联 · hs-link

[English](README.en.md) | 简体中文

A Chrome/Edge Manifest V3 extension that generates HS OpenAPI access links per tenant and employee — **no local service required**.

- **Toolbar popup** — pick a tenant and a person, then generate / copy / open the access link.
- **Settings page** — manage tenants, personnel, batch onboarding and encrypted-free backups.
- **No server** — the extension talks to the HS OpenAPI directly from the browser.

Current version: **1.4.3** ([CHANGELOG.md](./CHANGELOG.md))

[![CI](https://github.com/BetterYoung/hs-link-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/BetterYoung/hs-link-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Install

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge) and enable **Developer mode**.
2. Choose **Load unpacked** and select the extracted folder (the one that directly contains `manifest.json`).
3. Pin "小合·易联" to the toolbar.

Download the ready-to-install package from the [Releases page](https://github.com/BetterYoung/hs-link-extension/releases).

## Use

### 1. First tenant

1. Open the popup and click the settings icon.
2. Add a tenant: name, deployment type, HTTPS API base URL, access account (`appKey`) and access password (`appSecurity`).
3. SaaS deployments are pre-filled with the built-in service address; localized deployments use their own HTTPS origin.
4. Save. The enterprise ID may be left blank — the extension fetches it from the authorization response.
5. Tip: **从 cURL 导入** parses a pasted `getAccessToken` cURL command and fills in the address, `appKey` and `appSecurity`. Cookies and request headers are never stored.

### 2. Personnel

1. Pick the tenant in the left rail.
2. Add a person: fill in any of **personnel ID / code / phone / email**. The name may be left blank — it is filled from the matched employee.
3. Missing fields are completed from the employee record, without overwriting values you maintain.
4. Within one tenant, people are unique by personnel ID: saving an existing ID updates that record.

### 3. Generate a link

1. Back in the popup, choose the tenant and the person (both pickers are searchable).
2. Click **生成链接**. The default is the Web homepage, valid for 7 days, and can be reused.
3. Copy the link or open it in a new tab.

## Backup and migration

> [!WARNING]
> Backup files contain the access password **in plaintext**. Treat them like password files: never upload them to public drives, chat groups or repositories. The release ZIP itself contains no tenant data.

Export JSON from **导入 / 导出** in the settings page, then import it on the new machine — the extension validates the file, previews the counts and replaces the local workspace only after confirmation.

## Build from source

```bash
cd app
npm install
npm test
npm run build   # → app/dist/client
```

## Privacy

- Credentials live only in `chrome.storage.local`; nothing is uploaded anywhere.
- Access tokens and generated links are never persisted.
- The extension requests host permission for the API origin only, when you first use that tenant.

See [SECURITY.md](./SECURITY.md) for vulnerability reporting and the full data-handling notes.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © hs-link contributors