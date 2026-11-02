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

    TWO-REPO MODEL: this kit (solo-ai-kit) is shaped to be shared - a
    generalized handbook and starter templates with no project-specific or
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

    LOG, STAMP AND LOCK: every run writes two lines to $ClaudeHome\
    hooks-backup.log. The first is 'started', before the first copy. The
    second is the verdict (ok, ok-local, FAILED or busy) with duration and
    reason. A run writes $ClaudeHome\.last-state-backup only after
    git ls-remote shows the pushed commit on the remote. The stamp holds
    the time, the repo path, the commit and the remote ref. One run holds
    $ClaudeHome\.state-backup.lock for the whole transaction. The lock is
    an exclusive file handle, so the OS releases it when the process ends.
    A second launch logs 'busy' and exits 0. The kit's session-start hook
    reads the stamp and the log. It reports four states. A failure is
    newer than the last verified success, and a retry does not clear it.
    A 'started' has no verdict after 30 minutes. The stamp is older than
    48 hours. The stamp does not parse or is dated in the future. It
    reports a .git\index.lock if one is present. An exit code nobody
    reads is not a monitor. On the source machine a lock file left by a
    killed run blocked every commit for seven weeks. 109 failure lines
    went unread.

    COVERAGE: a missing required input fails the run and is named in the
    log line. The required inputs are the global CLAUDE.md, the projects
    directory, every configured extra path, and a remote to push to
    (unless -NoPush is given). A dry run prints SKIP instead. Every
    skipped directory is printed.

    EXCLUDED DIRECTORIES: if $ClaudeHome\backup-exclude-dirs.txt exists,
    any directory with a name listed in it is skipped in every copy. One
    directory NAME per line; blank lines and #-comments are ignored. This
    covers memory folders and extra paths alike, and each skip is printed.
    'worktrees' is always excluded. Use it for bulky material that can be
    made again and that lands under a memory folder. A 650 MiB folder
    copied on every run pushed the script past the session-end hook's time
    limit, and the kill mid-write left the lock.

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
    lives at ...\scratchpad\solo-ai-kit, the default resolves to
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
$LogFile = Join-Path $ClaudeHome 'hooks-backup.log'
$StampFile = Join-Path $ClaudeHome '.last-state-backup'
$ExcludeDirsFile = Join-Path $ClaudeHome 'backup-exclude-dirs.txt'
$RunStarted = Get-Date

function Finish-Run {
    # One log line per run that reached the git step, whatever happened; the
    # stamp only when the snapshot reached the remote. A failing run that
    # still stamped would silence the one line (session-start) that exists
    # to catch failing runs. Exits the script with $ExitCode.
    param(
        [Parameter(Mandatory = $true)][string]$Verdict,
        [string]$Reason = '',
        [int]$ExitCode = 0,
        [switch]$Stamp
    )
    $elapsed = [int]((Get-Date) - $RunStarted).TotalSeconds
    $when = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    $verdict = $Verdict
    $reason = $Reason
    $exitCode = $ExitCode
    if ($Stamp) {
        # Written FIRST, by an in-place replace of a complete temp file, so
        # the ok line below is never ahead of the record it vouches for and
        # a reader never sees a half-written or missing record. Line 2
        # names the repo so the session-start tripwire can look for a
        # .git\index.lock there and say so by path. Lines 3 and 4 are the
        # commit and the remote ref that were verified, so the record says
        # what is backed up, not only when. A record that cannot be written
        # turns the run into a failure: success nobody can read is not one.
        try {
            $tmp = $StampFile + '.tmp'
            Set-Content -Path $tmp -Value @($when, $BackupRepoPath, $VerifiedCommit, $VerifiedRef) -Encoding utf8
            # Move-Item -Force deletes the target before the move in PS 5.1,
            # so a reader could find no record at all. File.Replace swaps in
            # place; File.Move covers the first publication.
            if (Test-Path $StampFile) {
                [System.IO.File]::Replace($tmp, $StampFile, $null)
            } else {
                [System.IO.File]::Move($tmp, $StampFile)
            }
        } catch {
            $verdict = 'FAILED'
            $reason = 'success record could not be written: ' + $_.Exception.Message
            $exitCode = 1
        }
    }
    $line = ('{0}  backup-claude-state {1} ({2}s) {3}' -f $when, $verdict, $elapsed, $reason)
    try {
        Add-Content -Path $LogFile -Value $line -Encoding utf8
    } catch {
        Write-Info ('WARNING: could not append to ' + $LogFile)
    }
    if ($script:RunLockHandle) {
        try { $script:RunLockHandle.Dispose() } catch { }
    }
    exit $exitCode
}
$VerifiedCommit = ''
$VerifiedRef = ''

# Directory names skipped in every copy below. 'worktrees' is a Claude Code
# git-worktree convention and never backup-worthy; the rest come from the
# optional machine-local config file, one name per line.
$excludeDirNames = @('worktrees')
if (Test-Path $ExcludeDirsFile) {
    $excludeDirNames += @(Get-Content -Path $ExcludeDirsFile | ForEach-Object { $_.Trim() } | Where-Object {
        $_ -ne '' -and -not $_.StartsWith('#')
    })
}

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
        # Through Finish-Run, so a repo that moved or vanished is a FAILED
        # line the session-start tripwire can read, not a bare exit code.
        Finish-Run -Verdict 'FAILED' -Reason ('backup repo missing or not a git repo: {0}' -f $BackupRepoPath) -ExitCode 1
    }
    Write-Info ''
    Write-Info '(continuing in DRY RUN to show what the rest of this run would do)'
}

# ---------------------------------------------------------------------------
# 0b. One run at a time, and a death notice for a run that never reports.
#     The daily task and the session-end hook had no lock in common, so two
#     runs could overlap and commit a half-copied tree. The lock here is a
#     file handle opened with no sharing: the OS holds it, a run that dies
#     releases it, and nothing has to guess an age. The 'started' line goes
#     to the log before any copy, so a run killed mid-way (the hook's time
#     limit, the task's ExecutionTimeLimit, a power loss) leaves a 'started'
#     with no verdict after it. That is how the session-start tripwire sees
#     a kill nobody logged.
# ---------------------------------------------------------------------------
if (-not $DryRun) {
    $runLockPath = Join-Path $ClaudeHome '.state-backup.lock'
    try {
        $script:RunLockHandle = [System.IO.File]::Open($runLockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch [System.IO.IOException] {
        # Only a sharing violation (32) or a lock violation (33) proves that
        # another run owns the file. Any other I/O error is this run failing.
        $win32 = $_.Exception.HResult -band 0xFFFF
        if ($win32 -eq 32 -or $win32 -eq 33) {
            Write-Info ('Another backup run holds {0} - this one exits without touching anything.' -f $runLockPath)
            Finish-Run -Verdict 'busy' -Reason 'another run holds the lock' -ExitCode 0
        }
        Finish-Run -Verdict 'FAILED' -Reason ('could not open the run lock: ' + $_.Exception.Message) -ExitCode 1
    }
    try {
        Add-Content -Path $LogFile -Value ('{0}  backup-claude-state started' -f (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')) -Encoding utf8
    } catch {
        Write-Info ('WARNING: could not append to ' + $LogFile)
    }
}

# From here on, any terminating error becomes a FAILED verdict with the
# message, instead of a 'started' line with no end: $ErrorActionPreference
# is Stop, so an ordinary copy error would otherwise end the script with
# nothing logged until the overdue threshold. An abrupt kill still leaves
# only 'started'; that is what the overdue rule is for.
trap {
    if ($DryRun) { break }
    Finish-Run -Verdict 'FAILED' -Reason ('exception: ' + $_.Exception.Message) -ExitCode 1
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
} elseif ($DryRun) {
    Write-Info ('SKIP - no global CLAUDE.md found at {0}' -f $SourceClaudeMd)
} else {
    # A required input. A run that kept yesterday's copy while today's file
    # is missing would still stamp success.
    Finish-Run -Verdict 'FAILED' -Reason ('coverage: global CLAUDE.md not found at {0}' -f $SourceClaudeMd) -ExitCode 1
}

# ---------------------------------------------------------------------------
# 2. Every per-project memory/ directory
# ---------------------------------------------------------------------------
if (-not (Test-Path $SourceProjectsDir)) {
    Write-Info ('SKIP - no projects directory found at {0}' -f $SourceProjectsDir)
    if (-not $DryRun) {
        Finish-Run -Verdict 'FAILED' -Reason ('coverage: projects directory not found at {0}' -f $SourceProjectsDir) -ExitCode 1
    }
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
            # No secret filter here: memory notes are curated by hand and a
            # false positive would silently drop a note. Directory exclusions
            # do apply, and every skip is printed.
            Copy-FilteredTree -Source $memorySource -Destination $memoryDest -SecretPattern '' -ExcludeDirNames $excludeDirNames
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
    $missingExtra = @()
    foreach ($rawPath in $extraPaths) {
        $path = $rawPath.Trim().TrimEnd('\', '/')
        if (-not (Test-Path $path -PathType Container)) {
            # Listed by hand, so its absence is a coverage failure, not a
            # skip: a backup that quietly stopped carrying a configured
            # directory would still stamp success. Reported after the loop
            # so every missing path is named in one run.
            Write-Info ('MISSING - configured extra path not found (or not a directory): {0}' -f $path)
            $missingExtra += $path
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
            Copy-FilteredTree -Source $path -Destination $dest -SecretPattern $secretPattern -ExcludeDirNames $excludeDirNames
        }
    }
    if ($missingExtra.Count -gt 0 -and -not $DryRun) {
        Write-Info ''
        Write-Info ('{0} configured extra path(s) missing - nothing committed. Fix {1} or restore the directory, then re-run.' -f $missingExtra.Count, $ExtraPathsFile)
        Finish-Run -Verdict 'FAILED' -Reason ('coverage: configured extra path not found: {0}' -f ($missingExtra -join '; ')) -ExitCode 1
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
    # A run killed mid-write leaves .git\index.lock behind, and every later
    # git add fails on it with a generic message. Name the file and its age
    # instead, so the log line and the session-start tripwire can say what
    # is wrong. Not removed here: from this side a live git process on the
    # repo looks the same as a dead one's leftover.
    $indexLock = Join-Path $BackupRepoPath '.git\index.lock'
    if (Test-Path $indexLock) {
        $lockAgeMin = [int]((Get-Date) - (Get-Item $indexLock).LastWriteTime).TotalMinutes
        Write-Info ''
        Write-Info ('LOCK PRESENT: {0} ({1} min old). A live git process may own it. If none does, a killed run left it: remove it by hand and re-run.' -f $indexLock, $lockAgeMin)
        Finish-Run -Verdict 'FAILED' -Reason ('index.lock present, {0} min old: {1}' -f $lockAgeMin, $indexLock) -ExitCode 1
    }

    # Memory paths can pass 260 characters (a project directory name alone
    # can run to 150), and without core.longpaths git add fails on them with
    # "Filename too long". Set once, in the backup repo only, and say so.
    if ($env:OS -eq 'Windows_NT') {
        $longPaths = git config --get core.longpaths
        if ([string]::IsNullOrWhiteSpace($longPaths)) {
            git config core.longpaths true
            Write-Info 'set core.longpaths=true in the backup repo'
        }
    }

    git add -- $trackedPaths
    if ($LASTEXITCODE -ne 0) {
        Write-Info ''
        Write-Info 'git add failed - check git status by hand.'
        Finish-Run -Verdict 'FAILED' -Reason 'git add failed; check git status by hand' -ExitCode 1
    }

    $outcome = ''
    $pendingChanges = git status --porcelain -- $trackedPaths
    if ($LASTEXITCODE -ne 0) {
        Finish-Run -Verdict 'FAILED' -Reason 'git status failed' -ExitCode 1
    }
    if ([string]::IsNullOrWhiteSpace($pendingChanges)) {
        Write-Info ''
        Write-Info 'Nothing changed since the last snapshot - no commit made.'
        $outcome = 'no change'
    } else {
        $dateStamp = Get-Date -Format 'yyyy-MM-dd'
        $commitMessage = 'chore: backup Claude config + memory snapshot ({0})' -f $dateStamp
        git commit -m $commitMessage | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Info ''
            Write-Info ('Committed in {0}: {1}' -f $BackupRepoPath, $commitMessage)
            $outcome = 'committed'
        } else {
            Write-Info ''
            Write-Info 'git commit failed - check git status by hand.'
            Finish-Run -Verdict 'FAILED' -Reason 'git commit failed; check git status by hand' -ExitCode 1
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
        $outcome = $outcome + ', -NoPush: not off-machine, not stamped'
    } else {
        $hasRemote = git remote
        if ([string]::IsNullOrWhiteSpace($hasRemote)) {
            Write-Info ''
            # Deliberate -NoPush is one thing; an unattended run that has no
            # destination is a failure, whatever git returned.
            Write-Info 'No git remote configured - snapshot committed locally only, which is NOT a backup.'
            Write-Info ('  Add one: git -C "{0}" remote add origin <url>' -f $BackupRepoPath)
            Finish-Run -Verdict 'FAILED' -Reason ('no remote configured; {0} locally only' -f $outcome) -ExitCode 1
        } else {
            $branch = git rev-parse --abbrev-ref HEAD
            if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
                Finish-Run -Verdict 'FAILED' -Reason 'could not read the current branch' -ExitCode 1
            }
            # No 2>&1 here. git writes its progress ("To <url>", "master ->
            # master") to stderr even on success; redirecting a native exe's
            # stderr in PowerShell 5.1 wraps each line in a NativeCommandError
            # ErrorRecord, which $ErrorActionPreference = 'Stop' then turns
            # into a terminating error - failing the script on a push that
            # actually worked. Let stderr pass through and judge by exit code.
            git push origin $branch
            if ($LASTEXITCODE -eq 0) {
                # A push that returned 0 is git's claim. Ask the remote what it
                # holds and compare with local HEAD; only a match is a backup.
                $localHead = git rev-parse HEAD
                if ($LASTEXITCODE -ne 0 -or $localHead -notmatch '^[0-9a-f]{40}$') {
                    Finish-Run -Verdict 'FAILED' -Reason 'could not read local HEAD' -ExitCode 1
                }
                # The exact ref, and exactly one answer: a short pattern can
                # match more than one branch.
                $remoteLines = @(git ls-remote --exit-code origin ('refs/heads/{0}' -f $branch))
                $remoteHead = ''
                if ($LASTEXITCODE -eq 0 -and $remoteLines.Count -eq 1) {
                    $remoteHead = ($remoteLines[0] -split '\s+')[0]
                }
                if ($remoteHead -ne $localHead) {
                    Write-Info ''
                    Write-Info ('git push returned 0 but origin/{0} is "{1}" and local HEAD is {2} - NOT backed up off-machine.' -f $branch, $remoteHead, $localHead)
                    Finish-Run -Verdict 'FAILED' -Reason ('verify: origin/{0} is "{1}", local HEAD is {2}' -f $branch, $remoteHead, $localHead) -ExitCode 1
                }
                Write-Info ('Pushed {0} to origin; remote head {1} verified.' -f $branch, $remoteHead.Substring(0, 7))
                $outcome = $outcome + (', pushed {0} ({1})' -f $branch, $remoteHead.Substring(0, 7))
                $pushed = $true
                $VerifiedCommit = $remoteHead
                $VerifiedRef = 'origin/{0}' -f $branch
            } else {
                Write-Info ''
                Write-Info ('git push failed - the snapshot is committed locally but NOT backed up off-machine.')
                Write-Info ('  Retry by hand: git -C "{0}" push origin {1}' -f $BackupRepoPath, $branch)
                Finish-Run -Verdict 'FAILED' -Reason ('git push failed; {0} locally, not off-machine' -f $outcome) -ExitCode 1
            }
        }
    }
} finally {
    Pop-Location
}

# Only a snapshot that reached the remote counts as a backup, so only that
# path stamps. A local-only commit is logged as such and leaves the stamp
# alone; after 48 hours the session-start line says so.
if ($pushed) {
    Finish-Run -Verdict 'ok' -Reason $outcome -ExitCode 0 -Stamp
}
Finish-Run -Verdict 'ok-local' -Reason $outcome -ExitCode 0
