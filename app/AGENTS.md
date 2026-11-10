# Extension Project Instructions

## Product Structure

- `src/PopupApp.jsx` is the browser toolbar popup. It owns tenant/person selection, local-first person lookup, link generation, copy, and open actions.
- `src/App.jsx` is the settings page. It only owns tenant, personnel, and import/export management.
- `src/openapi.js` contains OpenAPI calls. Do not persist access tokens or generated links.
- `src/model.js` owns validation, storage, backup parsing, and personnel enrichment.
- `src/lookupPerson.js` owns popup lookup value normalization, local matching, and merging API results into local personnel; keep it free of React.
- `src/tenantOps.js` owns staff-ID upsert and cross-tenant batch resolution, plus the single `savePeopleToTenants` write path; keep it free of React so it stays unit-testable.
- `src/xlsx.js` owns the minimal xlsx reader/writer (ZIP + XML via `fflate`); it must stay DOM-free so `node --test` can parse templates.
- `src/importTenants.js` and `src/importPeople.js` own Excel header aliases, row validation, preview statuses, and template sheets.
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
- The popup person row has a dedicated 查询 button that opens the dimension panel directly (personnel ID, code, phone, email, name). The name dimension only filters local personnel; the other dimensions are local-first, then call the current tenant's API. Clicking 查询 runs the whole flow and selects the person; a successful API result is saved locally immediately, overwriting the matched record (by `staffId`, then code/phone/email) while keeping its record ID and retaining fields the API did not return. Lookup is scoped to the selected tenant and adds no manifest permissions.
- Both the popup and settings page listen to `chrome.storage.onChanged`; the popup re-reads storage before writing personnel, and the settings page applies external data without overwriting an open dialog's current selection.
- JSON backup import offers incremental merge or full replacement after validation and confirmation. Merge matches tenants by corporationId and people by staffId or record ID, preserves existing values, fills blanks and rejects ambiguous identity conflicts. Export includes plaintext credentials and excludes tokens and links.
- Excel import is incremental, never a full replacement: tenants merge by `corporationId` (keep people and record IDs) and personnel flow through `savePeopleToTenants`. A duplicated `staffId` overwrites that record and keeps its record ID.
- Personnel Excel import always resolves the staff record per tenant (`alwaysResolve`), even when a name is filled, to obtain the tenant-scoped staff ID. A row fails when the lookup finds nothing, when the resolved ID conflicts with the ID typed in the sheet, or when no lookup dimension is provided. Manual batch add keeps the old behavior: a filled name skips the lookup.
- One Excel file is capped at 100 rows for both tenant and personnel import; preview first, then execute. Templates write text number format on credential/phone/ID columns, and the reader flags numeric cells (tenant credentials block the row; personnel values warn).
- Template row 2 is a fixed example and is skipped automatically by the planner; edited example rows are treated as real data, so deleting it is optional.
- Excel import adds no manifest permissions: origins are requested in one batch up front, with per-row retry for leftovers.

## Verification

- Run `npm test` after behavior changes.
- Run `npm run build` before delivery.
- Do not add real tenant credentials to source, tests, fixtures, or documentation.
