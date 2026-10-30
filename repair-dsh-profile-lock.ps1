<#
.SYNOPSIS
  Repair the DSH desktop profile directory when startup fails with:
  EPERM: operation not permitted, open '...\.dsh\profiles\desktop\lock'

.DESCRIPTION
  DSH's Electron main process creates a single-instance file at
  %USERPROFILE%\.dsh\profiles\desktop\lock via openSync(path, "wx").
  On Windows that call only returns EPERM when the *directory* refuses
  creation for the current user (explicitly denied ACE / inherited deny /
  security product folder protection). A stale lock file yields EEXIST and
  an exclusively-held file yields EBUSY, so neither is the cause here.

  This script: reports state, clears read-only attributes, restores ACL
  inheritance on %USERPROFILE%\.dsh, re-grants the current user full
  control, removes a stale lock file, and verifies that a CREATE_NEW file
  can be created in the profile directory.

.PARAMETER DshHome
  Harness home. Defaults to $env:USERPROFILE\.dsh

.PARAMETER Profile
  Profile name whose directory must accept the lock file. Defaults to desktop.

.PARAMETER DryRun
  Only report; change nothing.

.PARAMETER KillProcesses
  Stop DeepSeek Harness / DSH processes before repairing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\repair-dsh-profile-lock.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\repair-dsh-profile-lock.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [string]$Profile = 'desktop',
  [switch]$DryRun,
  [switch]$KillProcesses
)

$ErrorActionPreference = 'Continue'
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$lockPath   = Join-Path $profileDir 'lock'
$user       = "$env:USERDOMAIN\$env:USERNAME"

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "   [ok]   $text" -ForegroundColor Green }
function Write-Warn2($text){ Write-Host "   [warn] $text" -ForegroundColor Yellow }
function Write-Fail($text) { Write-Host "   [fail] $text" -ForegroundColor Red }

Write-Host "DSH profile lock repair" -ForegroundColor White
Write-Host "  dsh home   : $DshHome"
Write-Host "  profile dir: $profileDir"
if ($DryRun) { Write-Host "  mode       : DRY RUN (nothing is changed)" -ForegroundColor Yellow }

# ---------------------------------------------------------------- 0. presence
Write-Step "0/6 check paths"
if (-not (Test-Path $DshHome)) {
  Write-Fail "$DshHome does not exist - is DSH installed for this user?"
  exit 2
}
if (-not (Test-Path $profileDir)) {
  Write-Warn2 "$profileDir does not exist yet; it will be created"
}

# ------------------------------------------------------- 1. running processes
Write-Step "1/6 DSH processes"
$procs = @(Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -match 'DeepSeek|dsh|electron' })
if ($procs.Count -eq 0) {
  Write-Ok 'no DSH process running'
} else {
  $procs | ForEach-Object { Write-Warn2 ("{0} (pid {1})" -f $_.ProcessName, $_.Id) }
  if ($KillProcesses) {
    $procs | ForEach-Object { try { $_.Kill(); Write-Ok "killed pid $($_.Id)" } catch { Write-Warn2 "cannot kill pid $($_.Id): $($_.Exception.Message)" } }
    Start-Sleep -Milliseconds 800
  } else {
    Write-Warn2 'close the app first (or rerun with -KillProcesses) before repairing'
  }
}

# ------------------------------------------------------------ 2. attributes
Write-Step "2/6 read-only attributes"
$ro = & cmd /c "attrib `"$DshHome`" /S /D" 2>$null | Select-String -Pattern '^\s*R' -SimpleMatch:$false
if ($ro) {
  Write-Warn2 "$($ro.Count) read-only item(s) under $DshHome"
  if (-not $DryRun) {
    & cmd /c "attrib -R `"$DshHome`"\* /S /D" | Out-Null
    Write-Ok 'cleared read-only attributes recursively'
  }
} else {
  Write-Ok 'no read-only attribute found'
}
if (Test-Path $lockPath) {
  $item = Get-Item -Force $lockPath
  $isDir = $item.PSIsContainer
  Write-Warn2 ("lock present: {0}, {1} bytes, attributes {2}" -f ($(if ($isDir) { 'DIRECTORY' } else { 'file' }), $item.Length, $item.Attributes))
  if ($isDir) { Write-Warn2 'a lock DIRECTORY is abnormal and must be removed' }
} else {
  Write-Ok 'no stale lock file'
}

# ------------------------------------------------------------------- 3. ACL
Write-Step "3/6 access control list"
foreach ($scope in @($DshHome, $profileDir)) {
  if (-not (Test-Path $scope)) { continue }
  Write-Host "   ---- $scope ----"
  $dump = & icacls $scope 2>&1
  $deny = @($dump | Select-String -Pattern '\(DENY\)')
  $dump | Where-Object { $_.ToString() -notmatch 'Successfully processed|Failed processing' } |
    ForEach-Object { Write-Host "   $($_.ToString().Trim())" }
  if ($deny.Count -gt 0) {
    Write-Warn2 ("{0} deny entry(ies) here" -f $deny.Count)
  } else {
    Write-Ok 'no explicit deny entry here'
  }
}

# ------------------------------------------------------------------ 4. repair
Write-Step "4/6 repair"
if ($DryRun) {
  Write-Host '   would run:'
  Write-Host "     icacls `"$DshHome`" /reset /T /C /Q"
  Write-Host "     icacls `"$DshHome`" /grant `"${user}:(OI)(CI)F`" /T /C /Q"
  Write-Host "     icacls `"$DshHome`" /remove:d `"$user`" /T /C /Q"
  Write-Host "     delete `"$lockPath`""
} else {
  & icacls $DshHome /remove:d $user /T /C /Q | Out-Null
  Write-Ok 'deny entries for the current user removed'
  & icacls $DshHome /reset /T /C /Q | Out-Null
  Write-Ok 'inheritance reset (explicit entries dropped)'
  & icacls $DshHome /grant "${user}:(OI)(CI)F" /T /C /Q | Out-Null
  Write-Ok "full control granted to $user (inheritable)"
  if (Test-Path $profileDir) {
    & icacls $profileDir /grant "${user}:(OI)(CI)F" /C /Q | Out-Null
    Write-Ok 'profile dir granted explicitly'
  }
  if (Test-Path $lockPath) {
    try {
      $it = Get-Item -Force $lockPath
      if ($it.PSIsContainer) { Remove-Item -LiteralPath $lockPath -Recurse -Force }
      else { Remove-Item -LiteralPath $lockPath -Force }
      Write-Ok 'stale lock removed'
    } catch { Write-Warn2 "cannot remove lock: $($_.Exception.Message)" }
  } else {
    Write-Ok 'no lock file to remove'
  }
}

# ------------------------------------------------------------------ 5. verify
Write-Step "5/6 verify CREATE_NEW in the profile dir"
if ($DryRun) {
  Write-Host "   skipped in dry run"
} else {
  if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir -Force | Out-Null }
  try {
    $fs = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew,
                                 [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $fs.Close()
    Remove-Item -LiteralPath $lockPath -Force
    Write-Ok 'CREATE_NEW succeeded - DSH can create its lock file'
  } catch {
    Write-Fail "CREATE_NEW still fails: $($_.Exception.Message)"
    Write-Host '   -> a security product is probably blocking writes to this folder.' -ForegroundColor Yellow
    Write-Host '      Add %USERPROFILE%\.dsh to its exclusions (Defender Controlled Folder' -ForegroundColor Yellow
    Write-Host '      Access, 360, Huorong, enterprise EDR), then rerun this script.' -ForegroundColor Yellow
    exit 1
  }
}

# ------------------------------------------------------------------- 6. next
Write-Step "6/6 next steps"
Write-Host '   1. start DeepSeek Harness again'
Write-Host "   2. if it still fails, send this file to support:"
Write-Host ("      " + (Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop\logs') + '\crash-<timestamp>-host.log')
Write-Host '   3. last resort: rename the profile dir so DSH rebuilds it, e.g.'
Write-Host ("      ren `"$profileDir`" `"$Profile.old`"")
Write-Host ''
