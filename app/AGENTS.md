# Extension Project Instructions

## Product Structure

- `src/PopupApp.jsx` is the browser toolbar popup. It owns tenant/person selection and link generation, copy, and open actions.
- `src/App.jsx` is the settings page. It only owns tenant, personnel, and import/export management.
- `src/openapi.js` contains OpenAPI calls. Do not persist access tokens or generated links.
- `src/model.js` owns validation, storage, backup parsing, and personnel enrichment.
- `src/tenantOps.js` owns staff-ID upsert and cross-tenant batch resolution; keep it free of React so it stays unit-testable.
- `public/manifest.json` is the Manifest V3 extension definition.
- `dist/client` is the only loadable extension deliverable.

## Confirmed Behavior

- Use `chrome.storage.local`; credentials are stored locally in plaintext by explicit product decision, with the password masked by default in the UI.
- SaaS tenants use the built-in default origin defined in `src/config.js`; localized tenants use their configured HTTPS origin.
- Personnel ID, code, phone, and email are complementary. When any field is missing, query `getStaffIds` in ID/code/phone/email order and fill only missing values.
- A blank personnel name is filled from the employee match before saving; a blank enterprise ID is filled from the authorization response.
- Within one tenant, personnel are unique by `staffId`; saving an existing `staffId` updates that record and keeps its record ID.
- `parseCurlCommand` reads only `--url` and `--data`/`-d` from a pasted cURL command; cookies and request headers are never stored.
- Personnel enrichment is silent on success. Keep permission, API, validation, and persistence errors visible.
- Popup link generation queries the employee record when any of staff ID, code, phone, or email is missing. This is existing behavior; changing it requires a separate versioned change.
- The popup uses Web homepage, 7-day expiry, and repeatable access. Generated links and tokens are not persisted.
- Import replaces the full local workspace only after validation and confirmation. Export includes plaintext credentials and excludes tokens and links.

## Verification

- Run `npm test` after behavior changes.
- Run `npm run build` before delivery.
- Do not add real tenant credentials to source, tests, fixtures, or documentation.
