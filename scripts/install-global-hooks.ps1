<#
.SYNOPSIS
    Install the kit's four machine-agnostic hooks (guardrail, prompt-context,
    agent-ledger, session-start) once into the machine-global Claude Code
    config, instead of per-project.

.DESCRIPTION
    See claude/README.md - "Two install modes: project-level vs
    machine-global" for the full rationale. Short version: Claude Code MERGES
    hooks from user-level (~/.claude/settings.json) and project-level
    (.claude/settings.json) config, and runs both. A hook wired in both homes
    fires twice per event. This script gives the four project-agnostic hooks
    a single, machine-global home so every session on the machine gets them
    - including repos that never ran bootstrap.ps1 - without also wiring them
    per-project. `scripts/bootstrap.ps1` dedupes automatically against
    whatever this script has installed (see its own comments), so running
    this once does not create double-fires on projects bootstrapped
    afterwards.

    The other three hooks in the kit (subagent-stall-check.sh,
    branch-sweep.sh, session-branch-count.sh) are project-specific - they
    read the current repo's branches - and stay project-level. This
    script does not touch them.

    What it does:
      1. Copies claude/hooks/{guardrail,prompt-context,agent-ledger,
         session-start}.js from this kit into <ClaudeDir>\hooks\, overwriting
         whatever is there (the kit is the canonical source).
      2. Merges the matching hook wiring into <ClaudeDir>\settings.json,
         WITHOUT touching anything already in that file: existing hooks,
         other settings keys, and any hook already wired in from elsewhere
         are all left as-is. An event only gets a new entry appended if no
         existing hook command already in that event references the same
         script filename - so re-running this script, or running it on a
         machine that already wired these hooks by hand, is a no-op.

    Written for Windows PowerShell 5.1 - no `&&`/`||`, no ternary, no
    null-coalescing/null-conditional operators, no `ConvertFrom-Json
    -AsHashtable` (5.1 doesn't have it - this script works against the
    PSCustomObject shape 5.1 actually returns).

.PARAMETER ClaudeDir
    Root of the machine-global Claude config to install into. Defaults to
    $env:USERPROFILE\.claude. Override for testing against a throwaway
    directory instead of the real global config.

.PARAMETER DryRun
    Print every action this run would take - files it would copy, settings
    entries it would add or skip - without copying or writing anything.

.EXAMPLE
    .\install-global-hooks.ps1 -DryRun

.EXAMPLE
    .\install-global-hooks.ps1

.EXAMPLE
    .\install-global-hooks.ps1 -ClaudeDir 'C:\temp\fake-claude-dir'
#>

[CmdletBinding()]
param(
    [string]$ClaudeDir = (Join-Path $env:USERPROFILE '.claude'),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$KitRoot = Split-Path -Parent $PSScriptRoot

# ---------------------------------------------------------------------------
# Helpers - PSCustomObject property get/set/ensure, since PS 5.1's
# ConvertFrom-Json returns PSCustomObject (not a hashtable), and assigning to
# a NoteProperty that doesn't exist yet throws unless it's created first.
# ---------------------------------------------------------------------------

function Test-HasProperty {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $false }
    return [bool](Get-Member -InputObject $Object -Name $Name -MemberType NoteProperty -ErrorAction SilentlyContinue)
}

function Set-NoteProperty {
    # Creates the property if missing, overwrites it if present. Add-Member
    # without -PassThru writes nothing to the pipeline, so this is safe to
    # call from inside a function that returns something else.
    param($Object, [string]$Name, $Value)
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Ensure-NoteProperty {
    param($Object, [string]$Name, $DefaultValue)
    if (-not (Test-HasProperty -Object $Object -Name $Name)) {
        Set-NoteProperty -Object $Object -Name $Name -Value $DefaultValue
    }
}

function Test-EventHasScript {
    # True when the given event already has a hook command that references
    # $ScriptFileName - i.e. it's already wired, from this script or by hand.
    param($HooksSection, [string]$EventName, [string]$ScriptFileName)
    if (-not (Test-HasProperty -Object $HooksSection -Name $EventName)) {
        return $false
    }
    $groups = @($HooksSection.$EventName)
    foreach ($group in $groups) {
        if ($null -eq $group) { continue }
        if (-not (Test-HasProperty -Object $group -Name 'hooks')) { continue }
        $entries = @($group.hooks)
        foreach ($entry in $entries) {
            if ($null -eq $entry) { continue }
            if (-not (Test-HasProperty -Object $entry -Name 'command')) { continue }
            if ($entry.command -match [regex]::Escape($ScriptFileName)) {
                return $true
            }
        }
    }
    return $false
}

function Add-EventHookEntry {
    # Appends one { matcher, hooks: [{ type, command, timeout }] } group to
    # $Settings.hooks.$EventName, unless that event already has a hook
    # command referencing $ScriptFileName. Returns $true only when it
    # actually changed $Settings (never under -DryRun, since nothing is
    # mutated then).
    param(
        $Settings,
        [string]$EventName,
        [string]$Matcher,
        [string]$Command,
        [int]$Timeout,
        [string]$ScriptFileName,
        [switch]$DryRun
    )

    Ensure-NoteProperty -Object $Settings -Name 'hooks' -DefaultValue (New-Object PSCustomObject)
    $hooksSection = $Settings.hooks

    if (Test-EventHasScript -HooksSection $hooksSection -EventName $EventName -ScriptFileName $ScriptFileName) {
        Write-Host ('    skip    - {0}: already has a hook referencing {1}' -f $EventName, $ScriptFileName) -ForegroundColor Yellow
        return $false
    }

    if ($DryRun) {
        Write-Host ('    [DRY RUN] would add to {0}: {1} (matcher "{2}", timeout {3})' -f $EventName, $Command, $Matcher, $Timeout) -ForegroundColor DarkGray
        return $false
    }

    $newHookCommand = New-Object PSCustomObject
    Set-NoteProperty -Object $newHookCommand -Name 'type' -Value 'command'
    Set-NoteProperty -Object $newHookCommand -Name 'command' -Value $Command
    Set-NoteProperty -Object $newHookCommand -Name 'timeout' -Value $Timeout

    $newGroup = New-Object PSCustomObject
    Set-NoteProperty -Object $newGroup -Name 'matcher' -Value $Matcher
    Set-NoteProperty -Object $newGroup -Name 'hooks' -Value @($newHookCommand)

    Ensure-NoteProperty -Object $hooksSection -Name $EventName -DefaultValue @()
    $existingGroups = @($hooksSection.$EventName)
    Set-NoteProperty -Object $hooksSection -Name $EventName -Value ($existingGroups + @($newGroup))

    Write-Host ('    added   - {0}: {1} (matcher "{2}", timeout {3})' -f $EventName, $Command, $Matcher, $Timeout) -ForegroundColor Green
    return $true
}

# ---------------------------------------------------------------------------
# Step 0 - report what we resolved
# ---------------------------------------------------------------------------
Write-Host ('Claude dir : {0}' -f $ClaudeDir)
if ($DryRun) {
    Write-Host ''
    Write-Host '*** DRY RUN - nothing will be copied or written ***' -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Step 1 - copy the four machine-agnostic hooks into <ClaudeDir>\hooks\
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '[1] Copy hooks into <ClaudeDir>\hooks\ (kit is canonical - overwrites)' -ForegroundColor Cyan

$hookFiles = @('guardrail.js', 'prompt-context.js', 'agent-ledger.js', 'session-start.js')
$sourceHooksDir = Join-Path $KitRoot 'claude\hooks'
$destHooksDir = Join-Path $ClaudeDir 'hooks'

if (-not (Test-Path $destHooksDir)) {
    if ($DryRun) {
        Write-Host ('    [DRY RUN] would create directory {0}' -f $destHooksDir) -ForegroundColor DarkGray
    } else {
        New-Item -ItemType Directory -Path $destHooksDir -Force | Out-Null
        Write-Host ('    created directory {0}' -f $destHooksDir) -ForegroundColor Green
    }
}

foreach ($file in $hookFiles) {
    $src = Join-Path $sourceHooksDir $file
    $dst = Join-Path $destHooksDir $file
    if ($DryRun) {
        Write-Host ('    [DRY RUN] would copy {0} -> {1}' -f $src, $dst) -ForegroundColor DarkGray
    } else {
        Copy-Item -Path $src -Destination $dst -Force
        Write-Host ('    copied {0} -> {1}' -f $src, $dst) -ForegroundColor Green
    }
}

# ---------------------------------------------------------------------------
# Step 2 - load (or start) <ClaudeDir>\settings.json
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '[2] Merge hook wiring into <ClaudeDir>\settings.json' -ForegroundColor Cyan

$settingsPath = Join-Path $ClaudeDir 'settings.json'
$settings = $null
if (Test-Path $settingsPath) {
    # -Encoding UTF8 matters here: an existing settings.json can carry
    # non-ASCII text (statusMessage strings, etc.), and PS 5.1's
    # Get-Content -Raw falls back to the system codepage for a BOM-less
    # file, silently mangling anything outside ASCII on read.
    $raw = Get-Content -Path $settingsPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        $settings = New-Object PSCustomObject
    } else {
        try {
            $settings = $raw | ConvertFrom-Json
        } catch {
            Write-Host ('    ERROR - {0} exists but is not valid JSON: {1}' -f $settingsPath, $_.Exception.Message) -ForegroundColor Red
            exit 1
        }
    }
    Write-Host ('    loaded existing {0}' -f $settingsPath) -ForegroundColor Green
} else {
    $settings = New-Object PSCustomObject
    Write-Host ('    no existing settings.json at {0} - starting from an empty object' -f $settingsPath) -ForegroundColor Yellow
}

# Command strings use forward slashes, matching the shape Claude Code itself
# writes on Windows (e.g. `node "C:/Users/you/.claude/hooks/guardrail.js"`).
$hooksDirForward = ($ClaudeDir.TrimEnd('\', '/') -replace '\\', '/') + '/hooks'

function New-HookCommand {
    # NOTE: the second parameter is deliberately NOT named $Args - that name
    # collides with PowerShell's automatic $args variable (unbound extra
    # arguments) and silently breaks binding, which is exactly the bug that
    # shipped here first: every -Args value was dropped and "start"/"stop"
    # never made it onto the agent-ledger.js commands. Caught by 5a's JSON
    # inspection, not by the parser (this is valid PS 5.1 syntax either way).
    param([string]$FileName, [string]$ExtraArg)
    $cmd = 'node "{0}/{1}"' -f $hooksDirForward, $FileName
    if ($ExtraArg) { $cmd = '{0} {1}' -f $cmd, $ExtraArg }
    return $cmd
}

$guardrailCmd = New-HookCommand -FileName 'guardrail.js' -ExtraArg ''
$promptContextCmd = New-HookCommand -FileName 'prompt-context.js' -ExtraArg ''
$sessionStartCmd = New-HookCommand -FileName 'session-start.js' -ExtraArg ''
$agentLedgerStartCmd = New-HookCommand -FileName 'agent-ledger.js' -ExtraArg 'start'
$agentLedgerStopCmd = New-HookCommand -FileName 'agent-ledger.js' -ExtraArg 'stop'

$anyChange = $false

if (Add-EventHookEntry -Settings $settings -EventName 'PreToolUse' -Matcher 'Bash|PowerShell' -Command $guardrailCmd -Timeout 10 -ScriptFileName 'guardrail.js' -DryRun:$DryRun) { $anyChange = $true }
if (Add-EventHookEntry -Settings $settings -EventName 'UserPromptSubmit' -Matcher '' -Command $promptContextCmd -Timeout 10 -ScriptFileName 'prompt-context.js' -DryRun:$DryRun) { $anyChange = $true }
if (Add-EventHookEntry -Settings $settings -EventName 'SessionStart' -Matcher '' -Command $sessionStartCmd -Timeout 20 -ScriptFileName 'session-start.js' -DryRun:$DryRun) { $anyChange = $true }
if (Add-EventHookEntry -Settings $settings -EventName 'SubagentStart' -Matcher '' -Command $agentLedgerStartCmd -Timeout 10 -ScriptFileName 'agent-ledger.js' -DryRun:$DryRun) { $anyChange = $true }
if (Add-EventHookEntry -Settings $settings -EventName 'TaskCreated' -Matcher '' -Command $agentLedgerStartCmd -Timeout 10 -ScriptFileName 'agent-ledger.js' -DryRun:$DryRun) { $anyChange = $true }
if (Add-EventHookEntry -Settings $settings -EventName 'SubagentStop' -Matcher '' -Command $agentLedgerStopCmd -Timeout 10 -ScriptFileName 'agent-ledger.js' -DryRun:$DryRun) { $anyChange = $true }
if (Add-EventHookEntry -Settings $settings -EventName 'TaskCompleted' -Matcher '' -Command $agentLedgerStopCmd -Timeout 10 -ScriptFileName 'agent-ledger.js' -DryRun:$DryRun) { $anyChange = $true }

if (-not $DryRun) {
    if ($anyChange) {
        $json = $settings | ConvertTo-Json -Depth 10
        # PS 5.1's Set-Content/Out-File -Encoding utf8 always writes a UTF-8
        # BOM. Every settings.json Claude Code actually loads is BOM-less,
        # and a strict JSON.parse chokes on one, so write BOM-less UTF-8
        # directly instead. WriteAllText resolves a relative path against
        # the .NET process's CurrentDirectory, which is NOT kept in sync
        # with PowerShell's own location ($PWD) - notably after
        # Push-Location, or in a host that never syncs the two. Resolve
        # through PowerShell's own path provider instead of
        # [System.IO.Path]::GetFullPath (that overload has the identical
        # blind spot: it also reads Environment.CurrentDirectory) so a
        # relative -ClaudeDir still lands where the user's shell says it
        # should, not wherever the process happened to start.
        $settingsFullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($settingsPath)
        [System.IO.File]::WriteAllText($settingsFullPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host ''
        Write-Host ('    wrote {0}' -f $settingsPath) -ForegroundColor Green
    } else {
        Write-Host ''
        Write-Host '    no changes needed - settings.json already has all four hooks wired' -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '======================================================================' -ForegroundColor Cyan
if ($DryRun) {
    Write-Host 'DRY RUN complete - nothing was copied or written.' -ForegroundColor Cyan
} else {
    Write-Host 'Install complete.' -ForegroundColor Cyan
    Write-Host ''
    Write-Host 'Restart Claude Code for the hook changes to take effect.' -ForegroundColor Magenta
}
Write-Host '======================================================================' -ForegroundColor Cyan
