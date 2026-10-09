# `/admin` and account UI test plan

Run these cases in an isolated local database first. Do not use real Supabase credentials or the production API during interface tests.

## Automated authorization and recovery cases

| ID | Control / flow | Expected result | Automated coverage |
|---|---|---|---|
| API-01 | Open project APIs without login | Project/material/progress data stays public | PASS |
| API-02 | Owner setup and profile | Exactly one protected Superadmin is created | PASS |
| API-03 | Owner creates Level 1, Level 2, and viewer | All three account levels are saved with the intended sync defaults | PASS |
| API-04 | Level 1 creates Level 2 | Allowed | PASS |
| API-05 | Level 1 creates a viewer or another Level 1 | Rejected | PASS |
| API-06 | Level 2 or viewer opens account management or creates an account | Rejected | PASS |
| API-07 | Level 1 tries a workbook import | Rejected; only Superadmin can change workbook data | PASS |
| API-08 | Delete/demote/deactivate owner through API or direct SQL | Rejected by API and database trigger | PASS |
| API-09 | Owner, Level 1, and Level 2 request Drive sync | Allowed; request is queued once | PASS |
| API-10 | Viewer without sync permission requests sync | Rejected | PASS |
| API-11 | Level 1 grants sync to a viewer | Viewer can then request sync; Level 1 cannot delete accounts | PASS |
| API-12 | Sync queue active/completed cooldown | Active request is reused; completed request is rate-limited | PASS |
| API-13 | Add email, verify OTP, replay OTP | First verification succeeds; duplicate and replay fail | PASS |
| API-14 | Forgot/reset password | Unknown address is not disclosed, reset code is single-use, old sessions are revoked | PASS |
| API-15 | Change password | Correct current password succeeds; incorrect current password fails | PASS |
| API-16 | Missing mail relay configuration | Email request fails closed with setup guidance | PASS |

## Browser interaction cases

Run each case at desktop `1440×900` and mobile `390×844` unless a case says otherwise. “Owner” means the protected Superadmin. Use a local SQLite database and a mock mail relay.

| ID | Button/control | Steps | Expected result |
|---|---|---|---|
| UI-01 | Public project view | Open `/` with no session | Data loads without a login wall |
| UI-02 | `/admin/` route | Open the clean route directly | Admin login appears; no redirect to the public page |
| UI-03 | Login submit | Enter valid privileged credentials and submit | Admin workspace opens; session is active |
| UI-04 | Invalid login | Submit a wrong password | Inline error; no account details are exposed |
| UI-05 | “Quên mật khẩu?” | Click from the login screen | Reset form opens; close and back controls work |
| UI-06 | “Gửi mã đặt lại” | Submit a verified test email | Generic confirmation appears and code form opens |
| UI-07 | Reset submit | Enter valid code and new password | Password changes, old sessions expire, new credentials work |
| UI-08 | Header account button | Click signed-in username/avatar | Profile panel opens and shows role/email state |
| UI-09 | Profile close button / outside click / Escape | Close profile three different ways | Panel closes and focus returns to page |
| UI-10 | “Gửi mã xác minh” | Enter a new email and submit | Success state appears; duplicate email shows an inline error |
| UI-11 | “Xác minh email” | Enter correct and then reused OTP | First succeeds and profile refreshes; reused code fails |
| UI-12 | “Đổi mật khẩu” | Try bad then correct current password | Error then success; existing session stays usable |
| UI-13 | Profile “Đăng xuất” and header logout icon | Click each logout control | Session is cleared; public data stays visible; `/admin/` asks for login |
| UI-14 | Admin navigation: “Tài khoản” | Owner/Level 1 clicks it | Account page opens without leaving the admin workspace |
| UI-15 | Create account submit | Owner creates a viewer, Level 1, and Level 2 | Success message and new row appear; invalid username/short password is blocked |
| UI-16 | Level selector | Compare Owner and Level 1 forms | Owner can choose viewer/L1/L2; Level 1 sees only Level 2 |
| UI-17 | “Cho người xem quyền đồng bộ” checkbox | Owner creates/toggles viewer with it unchecked/checked | Permission is saved correctly and reflected in row action |
| UI-18 | “Cho phép đồng bộ” / “Tắt quyền đồng bộ” | Owner or Level 1 toggles a viewer | Row updates immediately; viewer access changes at API |
| UI-19 | “Xóa tài khoản” cancel | Owner presses delete and cancels confirmation | Account remains unchanged |
| UI-20 | “Xóa tài khoản” confirm | Owner confirms on a non-owner account | Account and sessions are removed; owner row has no delete button |
| UI-21 | Level 1/Level 2 account actions | Open account route or inspect rows | Level 1 cannot create non-Level-2/delete; Level 2 cannot open account management |
| UI-22 | Admin navigation: “Đồng bộ dữ liệu” | Owner, L1, L2, and authorized viewer open it | Sync panel is available; other viewers do not see it |
| UI-23 | “Đồng bộ ngay” | Click once, click again while active | First queues; second reuses active request; status updates to completion/failure |
| UI-24 | Public view links inside admin | Click Overview, materials, project dashboard, progress | All pages stay within `/admin/`; user remains logged in |
| UI-25 | Mobile menu, backdrop, Escape | Open menu and close by each method | Drawer is usable, aligned, and closes reliably |
| UI-26 | Theme selector | Change light/dark theme while on admin/profile pages | Colors remain readable and selection persists on rerender |
| UI-27 | Admin upload/delete buttons | Owner opens data management; Level 1 tries direct URL/API | Owner controls are visible/usable; lower roles cannot mutate data |
| UI-28 | Responsive admin panels | Inspect account list, forms, buttons at 390 px | No horizontal overflow; controls are reachable by thumb/keyboard |
| UI-29 | Sidebar groups and collapse control | Expand/collapse Materials, Projects, and Admin; collapse sidebar; reopen on mobile | `aria-expanded`, child routes, focus, and drawer state stay in sync |
| UI-30 | Forgot-password “Quay lại đăng nhập” / close | Open recovery, return to login, reopen and close with × / Escape | Recovery state closes cleanly without changing credentials |
| UI-31 | Data type selector and file chooser | Switch PL/BTP ↔ QLDA; open file chooser; submit without a file | Correct import controls appear; empty submission is blocked |
| UI-32 | Import/delete confirmation | Import a synthetic workbook; cancel then confirm deleting only its test record | Import progress/result is visible; cancel preserves data; confirm removes test data |
| UI-33 | Profile form validation | Submit invalid email/code and short password in local-only account | Browser/API validation is clear; no credential is changed by invalid input |

## Browser run log

**Run:** 2026-10-09 · local-only stack (`/admin/`, API `127.0.0.1:8787`, mock mail relay `127.0.0.1:8788`) · owner, Level 1, Level 2, and sync-enabled viewer · desktop default and mobile override `390×844` (CSS content width 375 px).

**Passed in browser:** UI-01 (public page without login), UI-02, UI-03, UI-04, UI-05, UI-06 (local mock mailer), UI-08, UI-09 (close button, Escape, backdrop), UI-10/11 (email verification success and replay rejection), UI-13 (header and profile logout), UI-14, UI-15, UI-16, UI-17, UI-18, UI-20 (confirmed deletion of a synthetic local child account), UI-21 (Level 1 and Level 2 restrictions), UI-22 (owner, Level 1, Level 2, and delegated viewer), UI-23 (queued request reused and visible to delegated viewer after API fix), UI-24 (overview, BOM, and project dashboard stayed within `/admin/`), UI-25 (drawer opens, route click and outside tap close it), UI-26 (theme selection changed and restored), UI-28 (no horizontal overflow; profile modal fits).

**Partial / requires a separate action:** UI-07 and UI-12 password submissions were not performed in the browser; API tests cover them, and changing a credential requires the human to perform the final action. UI-19 delete-cancel, UI-25 Escape for the mobile drawer, UI-26 persistence after reload, UI-27/31/32, and UI-33 invalid form values were not fully exercised. UI-30 opened/closed the recovery panel, but “Quay lại đăng nhập” was not verified. The local database contained no project workbooks, so BTP print/export and project-data buttons that require rows were unavailable for browser interaction.

**Visual issue fixed during the run:** the reset-code form was visible before the recovery request because `.account-form { display:grid }` overrode the `hidden` attribute. Added an explicit hidden rule and verified it stays hidden after a rate-limited request. The delegated viewer initially received a 403 while polling another active sync request; status polling now requires sync permission and the integration test verifies shared progress access.

A backend/API test does not count as a browser UI pass. No production Supabase, Apps Script, or GitHub Pages endpoint was changed during this run.
