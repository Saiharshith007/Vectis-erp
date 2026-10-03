<#
  backup-db.ps1 — Make a timestamped backup of the Vectis data folder (db/).

  Your data (invoices, vendors, settings, users) lives in the db/ folder when
  running on local files. This script zips it into backups/ with a date-stamped
  name and keeps the most recent N copies.

  USAGE:
    powershell -ExecutionPolicy Bypass -File .\backup-db.ps1
    powershell -ExecutionPolicy Bypass -File .\backup-db.ps1 -Keep 30 -Dest "D:\VectisBackups"

  TIP: schedule it daily with Windows Task Scheduler so backups are automatic.
  For real safety, also copy the backups/ folder to an external drive or cloud.
#>

param(
    [string] $Dest = (Join-Path $PSScriptRoot 'backups'),
    [int]    $Keep = 30
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'db'

if (-not (Test-Path $source)) {
    Write-Host "ERROR: No db/ folder found at $source - nothing to back up." -ForegroundColor Red
    Write-Host "(If you use a PostgreSQL database instead, back it up with 'pg_dump'.)"
    exit 1
}

if (-not (Test-Path $Dest)) {
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
}

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$zip   = Join-Path $Dest "vectis-db_$stamp.zip"

Compress-Archive -Path (Join-Path $source '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Host "Backup created: $zip" -ForegroundColor Green

# Prune old backups, keeping the most recent $Keep.
$old = Get-ChildItem -Path $Dest -Filter 'vectis-db_*.zip' |
       Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep
if ($old) {
    $old | Remove-Item -Force
    Write-Host "Pruned $($old.Count) old backup(s); keeping the latest $Keep." -ForegroundColor Yellow
}
