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
    makes one dated git commit there and pushes it. This is the practical, portable
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

    OPTIONAL EXTRA PATHS: if $ClaudeHome\backup-extra-paths.txt exists (one
    absolute directory path per line; blank lines and #-comments skipped),
    each listed directory is mirrored into the backup repo too, under
    repos\<parent-dir-name>--<leaf-dir-name>\ (e.g. a project's git-ignored
    .claude\ automation - skills, workflows, hooks, settings - can ride
    along without this kit ever naming that project). A 'worktrees'
    subdirectory anywhere under an extra path is skipped (a Claude Code
    git-worktree convention, not backup-worthy state), and any file with a
    token/secret/password/api-key/bearer value assignment (or an AKIA/
    private-key pattern) is skipped and reported rather than copied. The
    config file itself lives outside both repos and is never committed by
    this script.

    EXIT CODE: 0 on success (including a no-op run when nothing changed);
    nonzero if the backup repo isn't set up yet, or a git command fails - so
    a scheduled/unattended run can be monitored on exit code alone.

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

.PARAMETER NoPush
    Commit the snapshot locally but skip the push. Off by default: a
    commit that never leaves the machine is not a backup. Use only when
    deliberately working offline.

.EXAMPLE
    .\backup-claude-state.ps1

.EXAMPLE
    .\backup-claude-state.ps1 -BackupRepoPath 'D:\backups\claude-state' -DryRun
#>

[CmdletBinding()]
param(
    [string]$ClaudeHome = (Join-Path $env:USERPROFILE '.claude'),
    [string]$BackupRepoPath = '',
    [switch]$DryRun,
    [switch]$NoPush
)

$ErrorActionPreference = 'Stop'

function Write-Info {
    param([string]$Message)
    Write-Host $Message
}

function Copy-FilteredTree {
    # Recursively mirrors $Source into $Destination, skipping:
    #   - any directory literally named 'worktrees' (a Claude Code
    #     git-worktree convention, not project-specific - without this an
    #     extra path that uses worktrees balloons the backup with full
    #     duplicate checkouts)
    #   - any file whose content looks secret-bearing per $SecretPattern
    # This is the safety net for the optional extra-paths mechanism below:
    # unlike the curated CLAUDE.md/memory copies above, an extra path can be
    # any directory, so it gets scanned before anything is mirrored into a
    # repo this script (or a caller) may later push.
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [string]$SecretPattern = '',
        [string[]]$ExcludeDirNames = @('worktrees')
    )
    if (-not (Test-Path $Destination)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }
    Get-ChildItem -Path $Source -Force | ForEach-Object {
        if ($_.PSIsContainer) {
            if ($ExcludeDirNames -contains $_.Name) {
                Write-Info ('  skip dir (excluded by name): {0}' -f $_.FullName)
                return
            }
            Copy-FilteredTree -Source $_.FullName -Destination (Join-Path $Destination $_.Name) -SecretPattern $SecretPattern -ExcludeDirNames $ExcludeDirNames
        } elseif ($SecretPattern -and (Select-String -Path $_.FullName -Pattern $SecretPattern -Quiet -ErrorAction SilentlyContinue)) {
            Write-Info ('  SKIP (looks secret-bearing, review by hand): {0}' -f $_.FullName)
        } else {
            Copy-Item -Path $_.FullName -Destination (Join-Path $Destination $_.Name) -Force
        }
    }
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
        exit 1
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
# 2b. Optional extra paths - machine-local, absent = no-op.
#     Lets git-ignored per-project Claude automation (skills/, workflows/,
#     hooks/, settings...) ride along in the same backup without this
#     shareable kit ever naming a specific project. One directory path per
#     line in $ExtraPathsFile; blank lines and lines starting with # are
#     skipped. Each listed directory is mirrored under
#     repos\<parent-dir-name>--<leaf-dir-name>\ (leading dots stripped from
#     the leaf, so ...\MyProject\.claude becomes repos\MyProject--claude\).
# ---------------------------------------------------------------------------
$ExtraPathsFile = Join-Path $ClaudeHome 'backup-extra-paths.txt'
# Requires a key-like word immediately followed by : or = and a value of some
# length, not just the bare word - a bare "secret" or "token" match is far too
# common in ordinary prose/CSS ("design tokens", "handles secrets") to be a
# usable signal on its own.
$secretPattern = '(?i)((password|passwd|pwd|api[_-]?key|secret|token|bearer)\s*[:=]\s*\S{6,}|AKIA[0-9A-Z]{16}|-----BEGIN[A-Z ]*PRIVATE KEY-----)'
if (-not (Test-Path $ExtraPathsFile)) {
    Write-Info ('SKIP - no extra-paths config at {0} (optional)' -f $ExtraPathsFile)
} else {
    $extraPaths = Get-Content -Path $ExtraPathsFile | Where-Object {
        $_.Trim() -ne '' -and -not $_.Trim().StartsWith('#')
    }
    foreach ($rawPath in $extraPaths) {
        $path = $rawPath.Trim().TrimEnd('\', '/')
        if (-not (Test-Path $path -PathType Container)) {
            Write-Info ('SKIP - extra path not found (or not a directory): {0}' -f $path)
            continue
        }
        $leaf = (Split-Path -Leaf $path).TrimStart('.')
        $parentName = Split-Path -Leaf (Split-Path -Parent $path)
        $destName = '{0}--{1}' -f $parentName, $leaf
        $dest = Join-Path $BackupRepoPath ('repos\{0}' -f $destName)
        if ($DryRun) {
            Write-Info ('[DRY RUN] would mirror {0} -> {1} (excluding worktrees dirs + secret-looking files)' -f $path, $dest)
        } else {
            if (Test-Path $dest) {
                Remove-Item -Path $dest -Recurse -Force
            }
            Write-Info ('mirroring {0} -> {1}' -f $path, $dest)
            Copy-FilteredTree -Source $path -Destination $dest -SecretPattern $secretPattern
        }
    }
}

# ---------------------------------------------------------------------------
# 3. Commit (inside the backup repo, never inside the kit repo)
# ---------------------------------------------------------------------------
$trackedPaths = @('CLAUDE.md', 'projects')
if (Test-Path (Join-Path $BackupRepoPath 'repos')) {
    $trackedPaths += 'repos'
}

if ($DryRun) {
    Write-Info ''
    Write-Info ('[DRY RUN] would run: git -C "{0}" add {1}' -f $BackupRepoPath, ($trackedPaths -join ' '))
    Write-Info ('[DRY RUN] would run: git -C "{0}" commit -m "chore: backup Claude config + memory snapshot (<date>)"' -f $BackupRepoPath)
    if (-not $NoPush) {
        Write-Info ('[DRY RUN] would run: git -C "{0}" push origin <current-branch>' -f $BackupRepoPath)
    }
    return
}

if (-not $backupRepoIsGit) {
    # Already reported (and exited nonzero) as a manual step above.
    return
}

Push-Location $BackupRepoPath
try {
    git add -- $trackedPaths
    if ($LASTEXITCODE -ne 0) {
        Write-Info ''
        Write-Info 'git add failed - check git status by hand.'
        exit 1
    }

    $pendingChanges = git status --porcelain -- $trackedPaths
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
            exit 1
        }
    }

    # -----------------------------------------------------------------------
    # 4. Push to the backup remote.
    #    Committing locally is not a backup: until this runs, every snapshot
    #    lives only on the machine the backup exists to survive the loss of.
    #    (Observed 2026-08-15: 12 daily snapshots had accumulated locally
    #    while the off-machine copy sat 15 days stale.)
    #    Pushed unconditionally, NOT only when this run made a commit, so an
    #    accumulated backlog drains on the next run.
    # -----------------------------------------------------------------------
    if ($NoPush) {
        Write-Info ''
        Write-Info '-NoPush given - snapshot committed locally only.'
    } else {
        $hasRemote = git remote
        if ([string]::IsNullOrWhiteSpace($hasRemote)) {
            Write-Info ''
            Write-Info 'No git remote configured - snapshot committed locally only.'
            Write-Info ('  Add one to make this a real off-machine backup: git -C "{0}" remote add origin <url>' -f $BackupRepoPath)
        } else {
            $branch = git rev-parse --abbrev-ref HEAD
            # No 2>&1 here. git writes its progress ("To <url>", "master ->
            # master") to stderr even on success; redirecting a native exe's
            # stderr in PowerShell 5.1 wraps each line in a NativeCommandError
            # ErrorRecord, which $ErrorActionPreference = 'Stop' then turns
            # into a terminating error - failing the script on a push that
            # actually worked. Let stderr pass through and judge by exit code.
            git push origin $branch
            if ($LASTEXITCODE -eq 0) {
                Write-Info ('Pushed {0} to origin.' -f $branch)
            } else {
                Write-Info ''
                Write-Info ('git push failed - the snapshot is committed locally but NOT backed up off-machine.')
                Write-Info ('  Retry by hand: git -C "{0}" push origin {1}' -f $BackupRepoPath, $branch)
                exit 1
            }
        }
    }
} finally {
    Pop-Location
}
