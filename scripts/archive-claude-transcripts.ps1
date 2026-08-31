<#
.SYNOPSIS
    Additively archive Claude Code session transcripts (the .jsonl files
    under ~\.claude\projects\) into a durable folder, before the app's own
    retention cleanup deletes them.

.DESCRIPTION
    Claude Code prunes old session transcripts from ~\.claude\projects\
    (cleanupPeriodDays, default ~30 days). For anyone treating their
    transcript history as a record worth keeping - an audit trail, a
    research corpus, the raw material behind published measurements - that
    cleanup is silent, rolling data loss. This script copies the projects
    tree into an archive folder on every run, so the archive accretes what
    the live tree forgets.

    ADDITIVE ONLY, BY CONSTRUCTION. The one trap in a transcript archive is
    a mirror: the source tree DELETES files as part of normal operation, so
    any sync that propagates deletions (robocopy /MIR, rclone sync) will
    faithfully replicate the exact loss the archive exists to prevent. This
    script uses robocopy WITHOUT /MIR or /PURGE: new and changed files are
    copied in, files that vanish from the source are never removed from the
    archive. Do not "improve" this into a mirror.

    Where the archive lives is configured once, outside this shareable kit:
    the first non-blank, non-comment line of <ClaudeHome>\transcript-archive-path.txt
    names the destination directory (an absolute path; a folder inside a
    synced location such as OneDrive makes the archive off-machine for
    free). The -ArchiveRoot parameter overrides the config file. With
    neither, the script prints the one-time setup and exits nonzero.

    On every run it appends one summary line (timestamp, robocopy exit
    code, dirs/files/bytes copied, duration) to <ClaudeHome>\hooks-archive.log.
    On success it also stamps <ClaudeHome>\.last-transcript-archive; the
    kit's session-start hook reads that stamp and warns at session start
    when the archive has not run for 48 hours, so a dead scheduled task is
    seen where the founder already looks instead of failing silently
    (README, practice: guards fail open - a tripwire counts only if
    consumption is mandatory).

    EXIT CODE: 0 on success (robocopy exit 0-7, which includes "nothing new
    to copy"); 1 when the destination is not configured or robocopy reports
    a real failure (exit 8+). A scheduled/unattended run can be monitored
    on exit code alone.

    Written for Windows PowerShell 5.1 - no `&&`/`||`, no ternary, no
    null-coalescing/null-conditional operators.

    Source paths are read-only inputs; nothing outside $ArchiveRoot,
    the log file and the stamp file is ever modified.

.PARAMETER ClaudeHome
    Root of the global Claude config. Defaults to $env:USERPROFILE\.claude.

.PARAMETER ArchiveRoot
    Destination directory for the archive. Defaults to the path named in
    <ClaudeHome>\transcript-archive-path.txt. The projects tree is copied
    into <ArchiveRoot>\raw\.

.PARAMETER DryRun
    Run robocopy in list-only mode (/L): report what would be copied
    without copying anything, and skip the log line and the stamp.

.EXAMPLE
    .\archive-claude-transcripts.ps1

.EXAMPLE
    .\archive-claude-transcripts.ps1 -ArchiveRoot 'D:\claude-transcript-archive' -DryRun
#>

[CmdletBinding()]
param(
    [string]$ClaudeHome = (Join-Path $env:USERPROFILE '.claude'),
    [string]$ArchiveRoot = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$SourceDir = Join-Path $ClaudeHome 'projects'
$ConfigFile = Join-Path $ClaudeHome 'transcript-archive-path.txt'
$LogFile = Join-Path $ClaudeHome 'hooks-archive.log'
$StampFile = Join-Path $ClaudeHome '.last-transcript-archive'

# ---------------------------------------------------------------------------
# 0. Resolve the destination. No config and no parameter means a one-time
#    manual step, reported rather than guessed - a default landing spot
#    chosen by this script could silently put the archive on the same disk,
#    same fate as the data it protects.
# ---------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($ArchiveRoot)) {
    if (Test-Path $ConfigFile) {
        $configured = Get-Content -Path $ConfigFile | Where-Object {
            $_.Trim() -ne '' -and -not $_.Trim().StartsWith('#')
        } | Select-Object -First 1
        if ($null -ne $configured) {
            $ArchiveRoot = $configured.Trim()
        }
    }
}
if ([string]::IsNullOrWhiteSpace($ArchiveRoot)) {
    Write-Host ''
    Write-Host ('MANUAL STEP REQUIRED - no archive destination configured.')
    Write-Host ('  Put the destination directory (absolute path, ideally inside a')
    Write-Host ('  synced folder such as OneDrive) on the first line of:')
    Write-Host ('    ' + $ConfigFile)
    Write-Host ('  or pass -ArchiveRoot explicitly. Then re-run this script.')
    exit 1
}

if (-not (Test-Path $SourceDir -PathType Container)) {
    Write-Host ('Nothing to archive - no projects directory at ' + $SourceDir)
    exit 1
}

$RawDest = Join-Path $ArchiveRoot 'raw'
Write-Host ('Source      : ' + $SourceDir)
Write-Host ('Archive raw : ' + $RawDest)
if ($DryRun) {
    Write-Host ''
    Write-Host '*** DRY RUN (robocopy /L) - nothing will be copied, logged or stamped ***'
}

# ---------------------------------------------------------------------------
# 1. The copy. /E everything including empty dirs; /XJ no junction loops;
#    /R:2 /W:2 so a file locked by a live session costs seconds, not the
#    default million retries; /NP /NFL /NDL /NJH keep output to the summary
#    block (without /NJH the job header's own "Files : *.*" line pollutes
#    the summary parse below). Deliberately NO /MIR and NO /PURGE - see the
#    header.
# ---------------------------------------------------------------------------
$roboArgs = @($SourceDir, $RawDest, '/E', '/XJ', '/R:2', '/W:2', '/NP', '/NFL', '/NDL', '/NJH')
if ($DryRun) {
    $roboArgs += '/L'
}

$started = Get-Date
$output = & robocopy @roboArgs
$exitCode = $LASTEXITCODE
$elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)

# Robocopy's exit code is a bitmask: 0 = nothing to do, 1-7 = copied and/or
# saw extras or mismatches, 8+ = at least one real failure.
$succeeded = ($exitCode -lt 8)

$summary = ($output | Where-Object { $_ -match '^\s*(Dirs|Files|Bytes)\s*:' }) -join '; '
$summary = ($summary -replace '\s+', ' ').Trim()
Write-Host ''
Write-Host ($output | Select-Object -Last 12 | Out-String)

# ---------------------------------------------------------------------------
# 2. Log and stamp. The log line is the run's record; the stamp is what the
#    session-start tripwire reads, so it is written ONLY on success - a
#    failing run that still stamped would silence the one warning that
#    exists to catch failing runs.
# ---------------------------------------------------------------------------
if (-not $DryRun) {
    $stampTime = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    $verdict = 'FAILED'
    if ($succeeded) {
        $verdict = 'ok'
    }
    $line = ('{0}  archive-claude-transcripts {1} (robocopy exit {2}, {3}s) {4}' -f $stampTime, $verdict, $exitCode, $elapsed, $summary)
    try {
        Add-Content -Path $LogFile -Value $line -Encoding utf8
    } catch {
        Write-Host ('WARNING: could not append to ' + $LogFile)
    }
    if ($succeeded) {
        Set-Content -Path $StampFile -Value $stampTime -Encoding utf8
    }
}

if ($succeeded) {
    Write-Host ('Archive run ok (robocopy exit ' + $exitCode + ', ' + $elapsed + 's).')
    exit 0
}
Write-Host ('Archive run FAILED (robocopy exit ' + $exitCode + ') - see ' + $LogFile)
exit 1
