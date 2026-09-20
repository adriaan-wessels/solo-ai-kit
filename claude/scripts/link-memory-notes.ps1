<#
.SYNOPSIS
    Hard-link this project's memory notes into <project>\.claude\memory so the
    Claude Code preview pane can open them.

.DESCRIPTION
    Memory notes live outside the project, under
    ~\.claude\projects\<slug>\memory\. The preview pane opens a file link only
    when the path resolves INSIDE the session working directory, so a link to a
    note fails with "Couldn't find this file ... it lives outside the working
    directory".

    A directory junction does not fix this: the pane canonicalises the reparse
    point back to the real location and then applies the containment check.
    Measured 2026-09-20 - the junction failed, plain repo paths worked.

    A hard link has no reparse point. The linked path IS a real path to the same
    file record, so canonicalisation has nothing to follow and the containment
    check passes.

    RUN THIS AFTER EDITS, NOT ONLY AFTER NEW NOTES. Both names point at one
    record, so an IN-PLACE write through either path shows through the other.
    But an editor that writes a temp file and renames it over the target -
    which most do, including Claude Code's own Edit tool - creates a NEW record
    and silently breaks the link. The other path then keeps serving the OLD
    content while looking perfectly current. Measured 2026-09-20: two files
    edited this way dropped from link count 2 to 1 on both sides, and the stale
    side still carried text the edit had removed.

    That is why the stale-copy branch below is not a nicety. Re-running repairs
    it, and nothing warns you otherwise - a broken link and a current one look
    identical in a directory listing.

    Idempotent and safe to re-run at any time.

.PARAMETER ProjectDir
    Project root. Defaults to two levels above this script, which is correct
    from both places the file lives: the kit's own claude\scripts\, and a
    bootstrapped project's .claude\scripts\. Pass it explicitly if you move
    the script anywhere else.

.PARAMETER DryRun
    Report what would change and touch nothing.

.NOTES
    Hard links require both paths on ONE volume. If the project and ~\.claude
    are on different drives this cannot work, and the script says so rather
    than reporting a silent success - a link step that quietly does nothing
    is worse than no link step, because the missing link looks identical to a
    note that was never written.
#>
[CmdletBinding()]
param(
    [string] $ProjectDir,
    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Resolve the default HERE, not in the param block. Under Windows PowerShell
# 5.1 `$PSScriptRoot` is EMPTY inside a param() default when the script runs
# through `-File`, so the default threw "Cannot bind argument ... empty string"
# for every bare invocation. It worked only when called with `&` from an
# already-running session, which is how it was first tested.
#
# session-start.js always passes -ProjectDir explicitly, so the hook never hit
# this and neither did the suite. A person typing the script name did.
if (-not $ProjectDir) {
    if (-not $PSScriptRoot) { throw 'Cannot determine the script directory. Pass -ProjectDir explicitly.' }
    $ProjectDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$ProjectDir = (Resolve-Path $ProjectDir).Path

# Claude Code derives a project's memory directory from its full path, with the
# colon and every separator replaced by a hyphen:
#   C:\Users\wesse\Dev\solo-ai-kit  ->  C--Users-wesse-Dev-solo-ai-kit
$slug = $ProjectDir -replace '[:\\/]', '-'
# CLAUDE_MEMLINK_HOME overrides the Claude home, so the fixture trees in
# session-start.selftest.js exercise the real repair against real hard links
# instead of the operator's own notes. session-start.js reads the same variable,
# and the two MUST agree: when they disagree the repair silently targets a
# different tree, reports success, and fixes nothing. That is how this branch
# was found.
$claudeHome = if ($env:CLAUDE_MEMLINK_HOME) { $env:CLAUDE_MEMLINK_HOME } else { Join-Path $env:USERPROFILE '.claude' }
$sourceDir = Join-Path $claudeHome (Join-Path 'projects' (Join-Path $slug 'memory'))
$destDir = Join-Path $ProjectDir '.claude\memory'

if (-not (Test-Path $sourceDir)) {
    Write-Host ('    SKIPPED - no memory directory yet at {0}' -f $sourceDir) -ForegroundColor DarkGray
    Write-Host '              (normal for a new project; re-run once notes exist)' -ForegroundColor DarkGray
    return
}

# Same-volume check, stated loudly. See .NOTES.
$srcRoot = [System.IO.Path]::GetPathRoot($sourceDir)
$dstRoot = [System.IO.Path]::GetPathRoot($ProjectDir)
if ($srcRoot -ne $dstRoot) {
    Write-Host ('    CANNOT LINK - {0} and {1} are on different volumes.' -f $dstRoot.TrimEnd('\'), $srcRoot.TrimEnd('\')) -ForegroundColor Red
    Write-Host '                  Hard links need one volume. Memory notes stay unlinkable here;' -ForegroundColor Red
    Write-Host '                  reference them by plain path instead of a markdown link.' -ForegroundColor Red
    return
}

if (-not (Test-Path $destDir)) {
    if ($DryRun) {
        Write-Host ('    DRY RUN - New-Item -ItemType Directory "{0}"' -f $destDir) -ForegroundColor Yellow
    } else {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
}

# fsutil prints the paths sharing a file record WITHOUT the drive letter, so
# compare on that form. Returns $true when $linkPath is already the same record
# as $sourcePath. That distinguishes a live hard link from a stale COPY, which
# an older version of this script or a manual copy can leave behind.
function Test-SameRecord {
    param([string] $LinkPath, [string] $SourcePath)
    if (-not (Test-Path $LinkPath)) { return $false }
    $wanted = $SourcePath.Substring([System.IO.Path]::GetPathRoot($SourcePath).Length - 1)
    $listed = & fsutil hardlink list $LinkPath 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    foreach ($line in $listed) {
        if ($line.Trim() -ieq $wanted) { return $true }
    }
    return $false
}

$created = 0; $already = 0; $replaced = 0; $failed = @()

foreach ($note in Get-ChildItem $sourceDir -Filter '*.md' -File) {
    $linkPath = Join-Path $destDir $note.Name

    if (Test-SameRecord -LinkPath $linkPath -SourcePath $note.FullName) { $already++; continue }

    if ($DryRun) {
        Write-Host ('    DRY RUN - link {0}' -f $note.Name) -ForegroundColor Yellow
        $created++
        continue
    }

    # A path that exists but is not the same record is a stale copy. Replace it:
    # leaving it would serve outdated content from a path that looks correct.
    if (Test-Path $linkPath) { Remove-Item $linkPath -Force; $replaced++ }

    & fsutil hardlink create $linkPath $note.FullName | Out-Null
    if ($LASTEXITCODE -eq 0 -and (Test-Path $linkPath)) { $created++ } else { $failed += $note.Name }
}

# Links whose note was deleted or renamed. Left alone they are a second, silent
# copy of a note the project believes it removed.
$orphans = @()
foreach ($link in Get-ChildItem $destDir -Filter '*.md' -File -ErrorAction SilentlyContinue) {
    if (-not (Test-Path (Join-Path $sourceDir $link.Name))) {
        $orphans += $link.Name
        if (-not $DryRun) { Remove-Item $link.FullName -Force }
    }
}

$summary = ('{0} linked, {1} already current' -f $created, $already)
if ($replaced) { $summary += (', {0} stale copy/copies replaced' -f $replaced) }
if ($orphans.Count) { $summary += (', {0} orphan(s) removed' -f $orphans.Count) }
Write-Host ('    DONE - {0} -> {1}' -f $summary, $destDir) -ForegroundColor Green

if ($failed.Count) {
    Write-Host ('    FAILED to link: {0}' -f ($failed -join ', ')) -ForegroundColor Red
    Write-Host '           Those notes stay unlinkable; reference them by plain path.' -ForegroundColor Red
}
