<#
  harden-firewall.ps1 — Lock down network access to the Vectis app on Windows.

  Vectis serves on TCP 8000 (HTTP) and 443 (HTTPS). This script controls who on
  the network can reach those ports. Loopback (this PC, http://localhost:8000) is
  NEVER affected by Windows Firewall, so the app keeps working locally either way.

  MODES
    LocalOnly  (default, most secure) — blocks the app ports from EVERY other
               machine. Only this PC can open the app. Choose this if one person
               runs and uses Vectis on this machine.
    Lan        — allows only machines on your local network (same subnet) to
               reach the app, and relies on Windows' default "deny inbound" to
               block everything else (e.g. the internet). Choose this if staff on
               your office network need to open the app in their browsers.

  USAGE (run PowerShell as Administrator):
    # Most secure — only this PC:
    powershell -ExecutionPolicy Bypass -File .\harden-firewall.ps1

    # Allow the local office network too:
    powershell -ExecutionPolicy Bypass -File .\harden-firewall.ps1 -Mode Lan

    # Custom ports:
    powershell -ExecutionPolicy Bypass -File .\harden-firewall.ps1 -Ports 8000,443

    # Undo everything this script added:
    powershell -ExecutionPolicy Bypass -File .\harden-firewall.ps1 -Remove
#>

param(
    [int[]]   $Ports = @(8000, 443),
    [ValidateSet('LocalOnly', 'Lan')]
    [string]  $Mode  = 'LocalOnly',
    [switch]  $Remove
)

$ErrorActionPreference = 'Stop'
$RulePrefix = 'Vectis -'

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
        Write-Host "ERROR: Please run this from an Administrator PowerShell." -ForegroundColor Red
        Write-Host "Right-click PowerShell -> 'Run as administrator', then run this script again."
        exit 1
    }
}

function Remove-VectisRules {
    Get-NetFirewallRule -DisplayName "$RulePrefix*" -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

Assert-Admin

# Always clear our previous rules first so the script is safe to re-run.
Remove-VectisRules

if ($Remove) {
    Write-Host "Removed all '$RulePrefix' firewall rules. Network access is back to Windows defaults." -ForegroundColor Yellow
    exit 0
}

foreach ($port in $Ports) {
    if ($Mode -eq 'LocalOnly') {
        # Block this port from every remote address. Loopback is exempt, so the
        # app still works on this PC; no other machine can connect.
        New-NetFirewallRule -DisplayName "$RulePrefix block remote $port" `
            -Direction Inbound -Action Block -Protocol TCP -LocalPort $port `
            -RemoteAddress Any -Profile Any | Out-Null
        Write-Host "[LocalOnly] Port $port blocked from all other machines (localhost still works)." -ForegroundColor Green
    }
    else {
        # Allow only same-subnet (LAN) machines. Everything else is denied by the
        # Windows default inbound policy.
        New-NetFirewallRule -DisplayName "$RulePrefix allow LAN $port" `
            -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port `
            -RemoteAddress LocalSubnet -Profile Private, Domain | Out-Null
        # Explicitly block the public profile so a coffee-shop/hotel network can
        # never reach it even if the port were somehow exposed.
        New-NetFirewallRule -DisplayName "$RulePrefix block public $port" `
            -Direction Inbound -Action Block -Protocol TCP -LocalPort $port `
            -RemoteAddress Any -Profile Public | Out-Null
        Write-Host "[Lan] Port $port allowed only from your local network; blocked on public networks." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Done. Verify with:  Get-NetFirewallRule -DisplayName '$RulePrefix*' | Format-Table DisplayName,Action,Enabled" -ForegroundColor Cyan
if ($Mode -eq 'Lan') {
    Write-Host "NOTE: Make sure your internet router does NOT port-forward $($Ports -join '/') to this PC." -ForegroundColor Yellow
}
