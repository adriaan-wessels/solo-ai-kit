<#
.SYNOPSIS
    Snapshot the founder's global Claude configuration + correction-capture
    memory into a SEPARATE, private backup repo and commit it there.

.DESCRIPTION
    Copies:
      - the global CLAUDE.md ($env:USERPROFILE\.claude\CLAUDE.md)
      - every per-project memory/ directory under
        $env:USERPROFILE\.claude\projects\*\memory\
    into a sibling repo (default: ..\claude-state next to this kit), then
    makes one dated git commit there. This is the practical, portable
    version of "the correction-capture memory loop is durable" (kit README,
    practice 3) - a point-in-time backup that survives a machine loss or a
    fresh install, independent of whatever sync/backup the Claude Code app
    itself does.

    TWO-REPO MODEL: this kit (solo-ai-playbook) is shaped to be shared - a
    generalized playbook and starter templates with no project-specific or
    personal content. The actual backup content (global CLAUDE.md, and
    especially the per-project memory/ files, which can span unrelated
    projects with their own private/client context) is real personal data
    and does NOT belong in a shareable repo. So this script writes to a
    separate local repo instead of committing into the kit's own working
    tree. Keep that backup repo private; this script does not publish it.

    Written for Windows PowerShell 5.1 - no `&&`/`||`, no ternary, no
    null-coalescing/null-conditional operators.

    Source paths ($ClaudeHome) are read-only inputs; nothing outside
    $BackupRepoPath is ever modified. Re-running replaces the previous
    snapshot in the backup repo (git history there keeps every prior
    version) and only commits if the snapshot actually changed.

.PARAMETER ClaudeHome
    Root of the global Claude config. Defaults to $env:USERPROFILE\.claude.

.PARAMETER BackupRepoPath
    Path to the (separate, already-`git init`'d) backup repo to write into.
    Defaults to a sibling of this kit's own repo root - i.e. if this kit
    lives at ...\scratchpad\solo-ai-playbook, the default resolves to
    ...\scratchpad\claude-state. That repo must already exist and be a git
    repository (this script does not create or initialize it - see the kit
    README's "State backup" section for the one-time setup).

.PARAMETER DryRun
    Print what would be copied and committed without touching anything.

.EXAMPLE
    .\backup-claude-state.ps1

.EXAMPLE
    .\backup-claude-state.ps1 -BackupRepoPath 'D:\backups\claude-state' -DryRun
#>

[CmdletBinding()]
param(
    [string]$ClaudeHome = (Join-Path $env:USERPROFILE '.claude'),
    [string]$BackupRepoPath = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Write-Info {
    param([string]$Message)
    Write-Host $Message
}

$KitRoot = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($BackupRepoPath)) {
    # Default: sibling of the kit's own repo root (..\claude-state).
    $BackupRepoPath = Join-Path $KitRoot '..\claude-state'
}
$BackupRepoPath = [System.IO.Path]::GetFullPath($BackupRepoPath)

$SourceClaudeMd = Join-Path $ClaudeHome 'CLAUDE.md'
$SourceProjectsDir = Join-Path $ClaudeHome 'projects'

Write-Info ('Claude home     : {0}' -f $ClaudeHome)
Write-Info ('Backup repo     : {0}' -f $BackupRepoPath)
if ($DryRun) {
    Write-Info ''
    Write-Info '*** DRY RUN - nothing will be copied or committed ***'
}

# ---------------------------------------------------------------------------
# 0. The backup repo must already exist as a git repo - this script only
#    ever writes INTO it, it never creates/initializes it, so a mistyped
#    -BackupRepoPath can't silently start committing into the wrong place.
# ---------------------------------------------------------------------------
$backupRepoIsGit = Test-Path (Join-Path $BackupRepoPath '.git')
if (-not $backupRepoIsGit) {
    Write-Info ''
    Write-Info ('MANUAL STEP REQUIRED - {0} does not exist or is not a git repo yet.' -f $BackupRepoPath)
    Write-Info '  Create it once (PowerShell 5.1):'
    Write-Info ('    New-Item -ItemType Directory -Path "{0}" -Force' -f $BackupRepoPath)
    Write-Info ('    git -C "{0}" init' -f $BackupRepoPath)
    Write-Info ('    git -C "{0}" config user.name "<your name>"   # if not already set globally' -f $BackupRepoPath)
    Write-Info ('    git -C "{0}" config user.email "<your email>" # if not already set globally' -f $BackupRepoPath)
    Write-Info 'Then re-run this script.'
    if (-not $DryRun) {
        return
    }
    Write-Info ''
    Write-Info '(continuing in DRY RUN to show what the rest of this run would do)'
}

# ---------------------------------------------------------------------------
# 1. Global CLAUDE.md
# ---------------------------------------------------------------------------
if (Test-Path $SourceClaudeMd) {
    $destClaudeMd = Join-Path $BackupRepoPath 'CLAUDE.md'
    if ($DryRun) {
        Write-Info ('[DRY RUN] would copy {0} -> {1}' -f $SourceClaudeMd, $destClaudeMd)
    } else {
        if (-not (Test-Path $BackupRepoPath)) {
            New-Item -ItemType Directory -Path $BackupRepoPath -Force | Out-Null
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
        $memoryDest = Join-Path $BackupRepoPath ('projects\{0}\memory' -f $projectDir.Name)
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
# 3. Commit (inside the backup repo, never inside the kit repo)
# ---------------------------------------------------------------------------
if ($DryRun) {
    Write-Info ''
    Write-Info ('[DRY RUN] would run: git -C "{0}" add CLAUDE.md projects' -f $BackupRepoPath)
    Write-Info ('[DRY RUN] would run: git -C "{0}" commit -m "chore: backup Claude config + memory snapshot (<date>)"' -f $BackupRepoPath)
    return
}

if (-not $backupRepoIsGit) {
    # Already reported as a manual step above; nothing to commit.
    return
}

Push-Location $BackupRepoPath
try {
    git add CLAUDE.md projects

    $pendingChanges = git status --porcelain -- CLAUDE.md projects
    if ([string]::IsNullOrWhiteSpace($pendingChanges)) {
        Write-Info ''
        Write-Info 'Nothing changed since the last snapshot - no commit made.'
    } else {
        $dateStamp = Get-Date -Format 'yyyy-MM-dd'
        $commitMessage = 'chore: backup Claude config + memory snapshot ({0})' -f $dateStamp
        git commit -m $commitMessage | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Info ''
            Write-Info ('Committed in {0}: {1}' -f $BackupRepoPath, $commitMessage)
        } else {
            Write-Info ''
            Write-Info 'git commit failed - check git status by hand.'
        }
    }
} finally {
    Pop-Location
}
