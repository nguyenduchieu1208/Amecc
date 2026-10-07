# AMECC Drive sync

This Apps Script watches the two private Drive folders and imports changed `*PL.xlsx` files from **Data** plus `.xlsx` project workbooks from **QLDA**. It reads both workbook types with the same parsers used by the website, skips the `Purchasing` sheet in PL workbooks, sends rows in safe chunks, and replaces the imported rows for each same-named source file. It also compares the current folder contents with the previously tracked file IDs and removes imported rows when a source workbook is deleted or moved out of its monitored folder. If a workbook is renamed or replaced with another file of the same name, it syncs the new source before cleaning up the old rows. It does not copy the original Excel files to GitHub or Supabase Storage.

## One-time setup

1. Deploy the latest AMECC website and Supabase function. The `drive-sync-parser.js` asset must be reachable from the GitHub Pages URL.
2. Create a strong random sync token. Store it as the Supabase Edge Function secret `DRIVE_SYNC_TOKEN`, and redeploy `amecc-api`. Do not commit or paste the token into `Code.gs`.
3. Open [Google Apps Script](https://script.google.com/home/start), create a project, paste `Code.gs`, and replace `appsscript.json` with the manifest in this folder (enable **Project Settings → Show "appsscript.json" manifest file** first).
4. In **Project Settings → Script Properties**, add:
   - `AMECC_DRIVE_FOLDER_ID` = `13DHt0iRys8IqultlVc0WDMlvv2IDq8E6`
   - `AMECC_DRIVE_SYNC_TOKEN` = the same token stored in Supabase
   - `AMECC_QLDA_DRIVE_FOLDER_ID` = `1418VlFe3m3mgA-81jgJ8F5vetAev9qKG` (optional; this folder is the default)
5. Run `setupAmeccDriveSync` once and approve the Google Drive read-only and external-request permissions. It installs a one-minute trigger and starts the first sync.

The first run scans all eligible files in both folders. Changed workbooks are retried if an API request fails; successful files are skipped until their Drive modification time, size, or filename changes. Check **Apps Script → Executions** for per-file `DONE`, `FAILED`, `REMOVED`, or `DELETE FAILED` records. A deletion API failure is queued and retried on the next trigger. `resetAmeccDriveSyncFailures` clears retry delays when you have corrected a permanent configuration issue.

## Website refresh button

After the first setup, replace `Code.gs` with the latest [repository version](https://raw.githubusercontent.com/nguyenduchieu1208/Amecc/main/drive-sync/Code.gs) and save it once. Keep the existing one-minute `syncAmeccDrive` trigger and Script Properties. To start a sync yourself immediately, run `syncAmeccDrive` from the Apps Script editor; otherwise, the existing trigger checks Drive each minute. It reads only changed or previously failed files and skips unchanged workbooks.

Use `stopAmeccDriveSync` to remove the time trigger. It leaves the data already imported on the site unchanged. When the site's workbook parser changes, run `npm run drive-sync:bundle` before deploying Pages so the pinned parser asset and its integrity hashes stay aligned.

When updating an existing Apps Script project after a parser/schema change, replace its `Code.gs` with this repository version and save it. Run `refreshAmeccQldaData` to re-import only project workbooks; it preserves PL/BTP sync markers and continues on later trigger runs if the first pass reaches its five-minute budget. Run `refreshAmeccDriveData` only when both PL/BTP and QLDA workbooks need a full re-import. This backfills newly parsed PL Remark notes and QLDA Shipment values into the site.

The importer currently accepts `.xlsx` files up to 20 MiB. A Google Apps Script execution is limited to six minutes, so the initial sync of 13 PL and 21 QLDA files may continue on later one-minute triggers if it reaches its per-run time budget. Later updates normally send only changed files.

## Token setup using Supabase CLI

Run this in PowerShell after `npx supabase login` and `npx supabase link --project-ref ymewopsgearpdsvzyaxb`:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$env:AMECC_DRIVE_SYNC_TOKEN = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
$rng.Dispose()
npx supabase secrets set "DRIVE_SYNC_TOKEN=$env:AMECC_DRIVE_SYNC_TOKEN" --project-ref ymewopsgearpdsvzyaxb
npx supabase functions deploy amecc-api --project-ref ymewopsgearpdsvzyaxb
```

Keep the generated value only long enough to paste into Apps Script Script Properties, then clear it from the current PowerShell session:

```powershell
Remove-Item Env:AMECC_DRIVE_SYNC_TOKEN
```
