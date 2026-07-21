<#
.SYNOPSIS
    Snapshot the founder's global Claude configuration + correction-capture
    memory into this repo's state/ directory and commit it.

.DESCRIPTION
    Copies:
      - the global CLAUDE.md ($env:USERPROFILE\.claude\CLAUDE.md)
      - every per-project memory/ directory under
        $env:USERPROFILE\.claude\projects\*\memory\
    into state/ inside this kit's own working tree, then makes one dated git
    commit. This is the practical, portable version of "the correction-
    capture memory loop is durable" (kit README, practice 3) — a point-in-
    time backup that survives a machine loss or a fresh install, independent
    of whatever sync/backup the Claude Code app itself does.

    Written for Windows PowerShell 5.1 - no `&&`/`||`, no ternary, no
    null-coalescing/null-conditional operators.

    Source paths are read-only inputs; nothing outside this repo's state/
    directory is ever modified. Re-running replaces the previous snapshot in
    state/ (git history keeps every prior version) and only commits if the
    snapshot actually changed.

.PARAMETER ClaudeHome
    Root of the global Claude config. Defaults to $env:USERPROFILE\.claude.

.PARAMETER DryRun
    Print what would be copied and committed without touching anything.

.EXAMPLE
    .\backup-claude-state.ps1
#>

[CmdletBinding()]
param(
    [string]$ClaudeHome = (Join-Path $env:USERPROFILE '.claude'),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Write-Info {
    param([string]$Message)
    Write-Host $Message
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $RepoRoot 'state'
$SourceClaudeMd = Join-Path $ClaudeHome 'CLAUDE.md'
$SourceProjectsDir = Join-Path $ClaudeHome 'projects'

Write-Info ('Claude home     : {0}' -f $ClaudeHome)
Write-Info ('Repo root       : {0}' -f $RepoRoot)
Write-Info ('state/ dest     : {0}' -f $StateDir)
if ($DryRun) {
    Write-Info ''
    Write-Info '*** DRY RUN - nothing will be copied or committed ***'
}

# ---------------------------------------------------------------------------
# 1. Global CLAUDE.md
# ---------------------------------------------------------------------------
if (Test-Path $SourceClaudeMd) {
    $destClaudeMd = Join-Path $StateDir 'CLAUDE.md'
    if ($DryRun) {
        Write-Info ('[DRY RUN] would copy {0} -> {1}' -f $SourceClaudeMd, $destClaudeMd)
    } else {
        if (-not (Test-Path $StateDir)) {
            New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
        }
        Copy-Item -Path $SourceClaudeMd -Destination $destClaudeMd -Force
        Write-Info ('copied {0} -> {1}' -f $SourceClaudeMd, $destClaudeMd)
    }
} else {
    Write-Info ('SKIP - no global CLAUDE.md found at {0}' -f $SourceClaudeMd)
}

# ---------------------------------------------------------------------------
# 2. Every per-project memory/ directory
# ---------------------------------------------------------------------------
if (-not (Test-Path $SourceProjectsDir)) {
    Write-Info ('SKIP - no projects directory found at {0}' -f $SourceProjectsDir)
} else {
    $projectDirs = Get-ChildItem -Path $SourceProjectsDir -Directory
    $copiedCount = 0
    foreach ($projectDir in $projectDirs) {
        $memorySource = Join-Path $projectDir.FullName 'memory'
        if (-not (Test-Path $memorySource)) {
            continue
        }
        $memoryDest = Join-Path $StateDir ('projects\{0}\memory' -f $projectDir.Name)
        if ($DryRun) {
            Write-Info ('[DRY RUN] would copy {0} -> {1}' -f $memorySource, $memoryDest)
        } else {
            if (Test-Path $memoryDest) {
                Remove-Item -Path $memoryDest -Recurse -Force
            }
            New-Item -ItemType Directory -Path $memoryDest -Force | Out-Null
            Copy-Item -Path (Join-Path $memorySource '*') -Destination $memoryDest -Recurse -Force
            Write-Info ('copied {0} -> {1}' -f $memorySource, $memoryDest)
        }
        $copiedCount = $copiedCount + 1
    }
    Write-Info ('{0} project memory director{1} processed' -f $copiedCount, $(if ($copiedCount -eq 1) { 'y' } else { 'ies' }))
}

# ---------------------------------------------------------------------------
# 3. Commit
# ---------------------------------------------------------------------------
if ($DryRun) {
    Write-Info ''
    Write-Info '[DRY RUN] would run: git -C <repo> add state'
    Write-Info '[DRY RUN] would run: git -C <repo> commit -m "chore(state): backup Claude config + memory snapshot (<date>)"'
    return
}

Push-Location $RepoRoot
try {
    git add state

    $pendingChanges = git status --porcelain -- state
    if ([string]::IsNullOrWhiteSpace($pendingChanges)) {
        Write-Info ''
        Write-Info 'Nothing changed in state/ since the last snapshot - no commit made.'
    } else {
        $dateStamp = Get-Date -Format 'yyyy-MM-dd'
        $commitMessage = 'chore(state): backup Claude config + memory snapshot ({0})' -f $dateStamp
        git commit -m $commitMessage | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Info ''
            Write-Info ('Committed: {0}' -f $commitMessage)
        } else {
            Write-Info ''
            Write-Info 'git commit failed - check git status by hand.'
        }
    }
} finally {
    Pop-Location
}
