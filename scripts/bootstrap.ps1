<#
.SYNOPSIS
    Bootstrap a new "solo founder + AI agents" project: repo, board, branch
    protection, and starter templates from this kit.

.DESCRIPTION
    Automates the repeatable slice of day-one project setup described in the
    kit README ("Day-one bootstrap"). Written for Windows PowerShell 5.1 —
    no `&&`/`||` chain operators, no ternary, no null-coalescing/null-
    conditional operators — so it runs on a stock Windows machine with no
    extra setup beyond `git` and the GitHub CLI (`gh`) being installed and
    `gh auth login` already done.

    Every step is printed as it runs (done / skipped / MANUAL STEP
    REQUIRED). Steps that can't be done through `gh`/the GitHub API print a
    clear manual instruction instead of failing the whole run. Re-running
    the script against an already-bootstrapped project skips what already
    exists rather than erroring.

.PARAMETER ProjectName
    Name of the new project. Used as the local directory name, the GitHub
    repo name, and the project board title.

.PARAMETER Owner
    GitHub user or org that will own the new repo and project board.
    Defaults to the currently authenticated `gh` user.

.PARAMETER Visibility
    'private' (default) or 'public'.

.PARAMETER Description
    One-line repo description. Optional.

.PARAMETER DestinationPath
    Directory under which the new project directory is created. Defaults to
    the current directory.

.PARAMETER RequiredCheckName
    The CI job name to require in branch protection. Leave the default
    placeholder if the project has no CI run yet — the script will print a
    manual follow-up instead of guessing a name that doesn't exist yet.

.PARAMETER DryRun
    Print every step that WOULD be performed, including resolved values
    (repo full name, owner, paths), without creating, modifying, or pushing
    anything — local or remote. Read-only lookups (e.g. resolving the
    current `gh` user, checking whether a repo/project already exists) still
    run under -DryRun so the preview reflects real values; nothing that
    creates or changes state does.

.EXAMPLE
    .\bootstrap.ps1 -ProjectName "my-new-app" -DryRun

.EXAMPLE
    .\bootstrap.ps1 -ProjectName "my-new-app" -Owner "myghuser" -Description "One-line pitch"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectName,

    [string]$Owner = '',

    [ValidateSet('private', 'public')]
    [string]$Visibility = 'private',

    [string]$Description = '',

    [string]$DestinationPath = (Get-Location).Path,

    [string]$RequiredCheckName = '<PLACEHOLDER: fill in after the first CI run, e.g. "Unit & Widget Tests">',

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$script:StepNumber = 0
$script:ManualSteps = New-Object System.Collections.Generic.List[string]
$script:GhAvailable = $false

function Write-StepHeader {
    param([string]$Message)
    $script:StepNumber = $script:StepNumber + 1
    Write-Host ''
    Write-Host ('[{0}] {1}' -f $script:StepNumber, $Message) -ForegroundColor Cyan
}

function Write-DoneLine {
    param([string]$Message)
    Write-Host ('    done    - {0}' -f $Message) -ForegroundColor Green
}

function Write-SkippedLine {
    param([string]$Message)
    Write-Host ('    skipped - {0}' -f $Message) -ForegroundColor Yellow
}

function Write-DryRunLine {
    param([string]$Message)
    Write-Host ('    [DRY RUN] would run: {0}' -f $Message) -ForegroundColor DarkGray
}

function Write-ManualLine {
    param([string]$Message)
    Write-Host ('    MANUAL STEP REQUIRED - {0}' -f $Message) -ForegroundColor Magenta
    $script:ManualSteps.Add($Message) | Out-Null
}

# ---------------------------------------------------------------------------
# Step 0 - preflight (read-only; runs even under -DryRun)
# ---------------------------------------------------------------------------
Write-StepHeader 'Preflight checks'

$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
if ($null -eq $ghCmd) {
    Write-ManualLine 'GitHub CLI (gh) not found on PATH. Install it from https://cli.github.com/ and run "gh auth login", then re-run this script.'
    $script:GhAvailable = $false
} else {
    $script:GhAvailable = $true
    Write-DoneLine ('found gh: {0}' -f $ghCmd.Source)
}

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $gitCmd) {
    Write-ManualLine 'git not found on PATH. Install git and re-run this script.'
} else {
    Write-DoneLine ('found git: {0}' -f $gitCmd.Source)
}

$ghAuthed = $false
if ($script:GhAvailable) {
    try {
        gh auth status 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $ghAuthed = $true
            Write-DoneLine 'gh is authenticated'
        } else {
            Write-ManualLine 'gh is installed but not authenticated. Run "gh auth login" and re-run this script.'
        }
    } catch {
        Write-ManualLine 'Could not determine gh auth status. Run "gh auth login" and re-run this script.'
    }
}

# Resolve Owner (read-only lookup - safe to run under -DryRun too, so the
# preview shows the real values this run would use).
if ([string]::IsNullOrWhiteSpace($Owner)) {
    if ($ghAuthed) {
        try {
            $Owner = (gh api user --jq .login 2>$null)
            if ([string]::IsNullOrWhiteSpace($Owner)) {
                $Owner = '<PLACEHOLDER: could not resolve gh user - pass -Owner explicitly>'
            } else {
                Write-DoneLine ('resolved Owner from gh: {0}' -f $Owner)
            }
        } catch {
            $Owner = '<PLACEHOLDER: could not resolve gh user - pass -Owner explicitly>'
        }
    } else {
        $Owner = '<PLACEHOLDER: pass -Owner explicitly - gh is not authenticated>'
    }
}

$RepoFullName = '{0}/{1}' -f $Owner, $ProjectName
$ProjectDir = Join-Path -Path $DestinationPath -ChildPath $ProjectName
$KitRoot = Split-Path -Parent $PSScriptRoot

Write-Host ''
Write-Host ('Project name : {0}' -f $ProjectName)
Write-Host ('Owner        : {0}' -f $Owner)
Write-Host ('Repo         : {0}' -f $RepoFullName)
Write-Host ('Visibility   : {0}' -f $Visibility)
Write-Host ('Local path   : {0}' -f $ProjectDir)
Write-Host ('Kit root     : {0}' -f $KitRoot)
if ($DryRun) {
    Write-Host ''
    Write-Host '*** DRY RUN - no local or remote state will be created or changed ***' -ForegroundColor Yellow
}

if (-not $script:GhAvailable -or -not $ghAuthed) {
    if (-not $DryRun) {
        Write-Host ''
        Write-Host 'Stopping - gh must be installed and authenticated before this script can automate anything beyond the preview above. Re-run with -DryRun to see the full plan anyway, or fix gh and re-run for real.' -ForegroundColor Red
        return
    }
}

# ---------------------------------------------------------------------------
# Step 1 - local project directory + git init
# ---------------------------------------------------------------------------
Write-StepHeader 'Local project directory + git init'

if (Test-Path -Path $ProjectDir) {
    Write-SkippedLine ('directory already exists: {0}' -f $ProjectDir)
} else {
    if ($DryRun) {
        Write-DryRunLine ('New-Item -ItemType Directory -Path "{0}"' -f $ProjectDir)
    } else {
        New-Item -ItemType Directory -Path $ProjectDir | Out-Null
        Write-DoneLine ('created {0}' -f $ProjectDir)
    }
}

$isGitRepo = $false
if (Test-Path -Path (Join-Path $ProjectDir '.git')) {
    $isGitRepo = $true
    Write-SkippedLine 'git repo already initialized'
} else {
    if ($DryRun) {
        Write-DryRunLine ('git init (in {0})' -f $ProjectDir)
    } else {
        Push-Location $ProjectDir
        try {
            git init | Out-Null
            Write-DoneLine 'git init'
            $isGitRepo = $true
        } finally {
            Pop-Location
        }
    }
}

# ---------------------------------------------------------------------------
# Step 2 - copy templates + starter files into the new project
# ---------------------------------------------------------------------------
Write-StepHeader 'Copy templates (CLAUDE.md, PR template, CI workflow, .gitignore)'

function Copy-TemplateFile {
    param(
        [string]$SourcePath,
        [string]$DestPath
    )
    if (Test-Path -Path $DestPath) {
        Write-SkippedLine ('{0} already exists' -f $DestPath)
        return
    }
    if ($DryRun) {
        Write-DryRunLine ('copy {0} -> {1}' -f $SourcePath, $DestPath)
        return
    }
    $destDir = Split-Path -Parent $DestPath
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -Path $SourcePath -Destination $DestPath
    Write-DoneLine ('copied {0}' -f $DestPath)
}

Copy-TemplateFile -SourcePath (Join-Path $KitRoot 'templates\CLAUDE.md') -DestPath (Join-Path $ProjectDir 'CLAUDE.md')
Copy-TemplateFile -SourcePath (Join-Path $KitRoot 'templates\pull_request_template.md') -DestPath (Join-Path $ProjectDir '.github\pull_request_template.md')
Copy-TemplateFile -SourcePath (Join-Path $KitRoot 'templates\ci\generic-ci.yml') -DestPath (Join-Path $ProjectDir '.github\workflows\ci.yml')

$gitignorePath = Join-Path $ProjectDir '.gitignore'
if (Test-Path $gitignorePath) {
    Write-SkippedLine '.gitignore already exists'
} elseif ($DryRun) {
    Write-DryRunLine ('write starter .gitignore -> {0}' -f $gitignorePath)
} else {
    $gitignoreContent = @'
# OS junk
.DS_Store
Thumbs.db

# Local agent-automation layer - see claude/README.md in the solo-ai-playbook
# kit for why this stays out of the repo.
.claude/
'@
    Set-Content -Path $gitignorePath -Value $gitignoreContent -Encoding utf8
    Write-DoneLine ('wrote {0}' -f $gitignorePath)
}

Write-StepHeader 'Copy claude/ automation layer (local disk only - never committed)'
$claudeDestDir = Join-Path $ProjectDir '.claude'
if (Test-Path $claudeDestDir) {
    Write-SkippedLine ('.claude already exists at {0}' -f $claudeDestDir)
} elseif ($DryRun) {
    Write-DryRunLine ('Copy-Item -Recurse "{0}\claude\*" -Destination "{1}"' -f $KitRoot, $claudeDestDir)
} else {
    New-Item -ItemType Directory -Path $claudeDestDir -Force | Out-Null
    Copy-Item -Recurse -Path (Join-Path $KitRoot 'claude\*') -Destination $claudeDestDir
    Write-DoneLine ('copied claude/ -> {0} (git-ignored, see .gitignore above)' -f $claudeDestDir)
}

# ---------------------------------------------------------------------------
# Step 3 - initial commit
# ---------------------------------------------------------------------------
Write-StepHeader 'Initial commit'

if ($DryRun) {
    Write-DryRunLine ('git -C "{0}" add CLAUDE.md .github .gitignore' -f $ProjectDir)
    Write-DryRunLine ('git -C "{0}" commit -m "chore: bootstrap project from solo-ai-playbook kit"' -f $ProjectDir)
} else {
    Push-Location $ProjectDir
    try {
        $hasCommits = $false
        try {
            git rev-parse HEAD 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $hasCommits = $true }
        } catch {
            $hasCommits = $false
        }
        if ($hasCommits) {
            Write-SkippedLine 'repo already has at least one commit'
        } else {
            git add CLAUDE.md .github .gitignore
            git commit -m 'chore: bootstrap project from solo-ai-playbook kit' | Out-Null
            Write-DoneLine 'created initial commit'
        }
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# Step 4 - create GitHub repo from the local directory + push
# ---------------------------------------------------------------------------
Write-StepHeader 'Create GitHub repo + push'

$repoExists = $false
if (-not $DryRun) {
    try {
        gh repo view $RepoFullName 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $repoExists = $true }
    } catch {
        $repoExists = $false
    }
}

if ($repoExists) {
    Write-SkippedLine ('repo {0} already exists on GitHub' -f $RepoFullName)
} elseif ($DryRun) {
    Write-DryRunLine ('gh repo create "{0}" --{1} --description "{2}" --source "{3}" --remote origin --push' -f $RepoFullName, $Visibility, $Description, $ProjectDir)
} else {
    Push-Location $ProjectDir
    try {
        $visFlag = '--' + $Visibility
        gh repo create $RepoFullName $visFlag --description $Description --source . --remote origin --push
        if ($LASTEXITCODE -eq 0) {
            Write-DoneLine ('created {0} and pushed initial commit' -f $RepoFullName)
        } else {
            Write-ManualLine ('gh repo create failed for {0}. Create it by hand: https://github.com/new (owner: {1}, name: {2}, visibility: {3}), then from {4} run: git remote add origin https://github.com/{0}.git ; then: git push -u origin HEAD' -f $RepoFullName, $Owner, $ProjectName, $Visibility, $ProjectDir)
        }
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# Step 5 - enable squash auto-merge on the repo
# ---------------------------------------------------------------------------
Write-StepHeader 'Enable squash auto-merge'

if ($DryRun) {
    Write-DryRunLine ('gh repo edit "{0}" --enable-auto-merge --enable-squash-merge --delete-branch-on-merge' -f $RepoFullName)
} else {
    try {
        gh repo edit $RepoFullName --enable-auto-merge --enable-squash-merge --delete-branch-on-merge
        if ($LASTEXITCODE -eq 0) {
            Write-DoneLine 'auto-merge (squash) enabled, merged branches auto-deleted'
        } else {
            Write-ManualLine ('Could not enable auto-merge via gh. Do it manually: https://github.com/{0}/settings -> "Pull Requests" section -> check "Allow auto-merge" and "Allow squash merging".' -f $RepoFullName)
        }
    } catch {
        Write-ManualLine ('Could not enable auto-merge via gh. Do it manually: https://github.com/{0}/settings -> "Pull Requests" section -> check "Allow auto-merge" and "Allow squash merging".' -f $RepoFullName)
    }
}

# ---------------------------------------------------------------------------
# Step 6 - GitHub Projects (v2) board: Backlog / Next / In Progress / Done
# ---------------------------------------------------------------------------
Write-StepHeader 'Create project board (Backlog / Next / In Progress / Done)'

$projectNumber = $null

if ($DryRun) {
    Write-DryRunLine ('gh project create --owner "{0}" --title "{1}" --format json' -f $Owner, $ProjectName)
    Write-DryRunLine 'delete the default "Status" single-select field via GraphQL (deleteProjectV2Field) - the GitHub API has no mutation to edit an existing single-select field''s options in place'
    Write-DryRunLine ('gh project field-create <number> --owner "{0}" --name "Status" --data-type SINGLE_SELECT --single-select-options "Backlog,Next,In Progress,Done"' -f $Owner)
    Write-DryRunLine ('gh project link <number> --owner "{0}" --repo "{1}"' -f $Owner, $RepoFullName)
} else {
    # Idempotency: see if a project with this title already exists for Owner.
    $existingProjectNumber = $null
    try {
        $existingProjectsJson = gh project list --owner $Owner --format json 2>$null
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingProjectsJson)) {
            $existingProjects = $existingProjectsJson | ConvertFrom-Json
            foreach ($p in $existingProjects.projects) {
                if ($p.title -eq $ProjectName) {
                    $existingProjectNumber = $p.number
                }
            }
        }
    } catch {
        $existingProjectNumber = $null
    }

    if ($null -ne $existingProjectNumber) {
        $projectNumber = $existingProjectNumber
        Write-SkippedLine ('project board "{0}" already exists (#{1})' -f $ProjectName, $projectNumber)
    } else {
        try {
            $createJson = gh project create --owner $Owner --title $ProjectName --format json
            if ($LASTEXITCODE -eq 0) {
                $created = $createJson | ConvertFrom-Json
                $projectNumber = $created.number
                Write-DoneLine ('created project board "{0}" (#{1})' -f $ProjectName, $projectNumber)
            } else {
                Write-ManualLine ('gh project create failed. Create the board by hand: https://github.com/users/{0}/projects/new (or https://github.com/orgs/{0}/projects/new for an org), title it "{1}".' -f $Owner, $ProjectName)
            }
        } catch {
            Write-ManualLine ('gh project create failed. Create the board by hand: https://github.com/users/{0}/projects/new (or https://github.com/orgs/{0}/projects/new for an org), title it "{1}".' -f $Owner, $ProjectName)
        }
    }

    if ($null -ne $projectNumber) {
        # Rebuild the Status field with the right options. The GitHub GraphQL
        # API has no mutation to edit an existing single-select field's
        # options in place (only to add/replace the whole field), so: delete
        # the default Status field, recreate it with the same name and the
        # options this kit wants.
        try {
            $fieldListJson = gh project field-list $projectNumber --owner $Owner --format json
            $fields = $fieldListJson | ConvertFrom-Json
            $statusField = $null
            foreach ($f in $fields.fields) {
                if ($f.name -eq 'Status') { $statusField = $f }
            }
            if ($null -eq $statusField) {
                Write-ManualLine ('Could not find the default "Status" field on project #{0}. Add a single-select field named "Status" by hand with options: Backlog, Next, In Progress, Done. https://github.com/users/{1}/projects/{0}/settings/fields' -f $projectNumber, $Owner)
            } else {
                $deleteQuery = 'mutation($id: ID!) { deleteProjectV2Field(input: { fieldId: $id }) { clientMutationId } }'
                $statusFieldId = $statusField.id
                gh api graphql -f "query=$deleteQuery" -f "id=$statusFieldId" | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    Write-DoneLine 'deleted default Status field options (Todo/In Progress/Done)'
                    gh project field-create $projectNumber --owner $Owner --name 'Status' --data-type SINGLE_SELECT --single-select-options 'Backlog,Next,In Progress,Done'
                    if ($LASTEXITCODE -eq 0) {
                        Write-DoneLine 'recreated Status field with options: Backlog, Next, In Progress, Done'
                    } else {
                        Write-ManualLine ('Deleted the default Status field but recreating it failed. Add it by hand: single-select field named "Status", options Backlog / Next / In Progress / Done. https://github.com/users/{0}/projects/{1}/settings/fields' -f $Owner, $projectNumber)
                    }
                } else {
                    Write-ManualLine ('Could not delete the default Status field (may need the "project" gh auth scope - check with "gh auth status"). Edit it by hand to have exactly these options: Backlog, Next, In Progress, Done. https://github.com/users/{0}/projects/{1}/settings/fields' -f $Owner, $projectNumber)
                }
            }
        } catch {
            Write-ManualLine ('Could not rebuild the Status field programmatically. Edit it by hand to have exactly these options: Backlog, Next, In Progress, Done. https://github.com/users/{0}/projects/{1}/settings/fields' -f $Owner, $projectNumber)
        }

        # Link the board to the repo so issues can be added to it directly.
        try {
            gh project link $projectNumber --owner $Owner --repo $RepoFullName
            if ($LASTEXITCODE -eq 0) {
                Write-DoneLine ('linked project #{0} to {1}' -f $projectNumber, $RepoFullName)
            } else {
                Write-ManualLine ('Could not link the project board to the repo. Do it by hand: open the project, "..." menu -> "Link a repository" -> {0}.' -f $RepoFullName)
            }
        } catch {
            Write-ManualLine ('Could not link the project board to the repo. Do it by hand: open the project, "..." menu -> "Link a repository" -> {0}.' -f $RepoFullName)
        }
    }
}

# ---------------------------------------------------------------------------
# Step 7 - branch protection on the default branch
# ---------------------------------------------------------------------------
Write-StepHeader 'Branch protection on the default branch'

if ($DryRun) {
    Write-DryRunLine ('gh repo view "{0}" --json defaultBranchRef --jq .defaultBranchRef.name' -f $RepoFullName)
    Write-DryRunLine ('PUT repos/{0}/branches/<default>/protection with required_status_checks=["{1}"], enforce_admins=true, allow_force_pushes=false, allow_deletions=false' -f $RepoFullName, $RequiredCheckName)
} else {
    $defaultBranch = $null
    try {
        $defaultBranch = gh repo view $RepoFullName --json defaultBranchRef --jq '.defaultBranchRef.name' 2>$null
    } catch {
        $defaultBranch = $null
    }
    if ([string]::IsNullOrWhiteSpace($defaultBranch)) {
        Write-ManualLine ('Could not resolve the default branch for {0}. Set branch protection by hand: https://github.com/{0}/settings/branches - require status checks, enable "Do not allow bypassing the above settings" (enforce_admins), disable force pushes and branch deletion.' -f $RepoFullName)
    } else {
        if ($RequiredCheckName -like '<PLACEHOLDER*') {
            Write-ManualLine ('No real CI job name known yet (no CI run exists). Once the first CI run completes, set branch protection with the real job name: https://github.com/{0}/settings/branches -> Add rule for "{1}" -> require status checks to pass, add the job name, enable "Do not allow bypassing the above settings", disable force pushes and branch deletion.' -f $RepoFullName, $defaultBranch)
        } else {
            $protectionBody = @"
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["$RequiredCheckName"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
"@
            try {
                $protectionBody | gh api -X PUT ('repos/{0}/branches/{1}/protection' -f $RepoFullName, $defaultBranch) --input - | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    Write-DoneLine ('branch protection set on {0} (required check: {1}, enforce_admins on, force-push/delete off)' -f $defaultBranch, $RequiredCheckName)
                } else {
                    Write-ManualLine ('Setting branch protection via gh api failed. Set it by hand: https://github.com/{0}/settings/branches -> Add rule for "{1}" -> require status check "{2}", enable "Do not allow bypassing the above settings", disable force pushes and branch deletion.' -f $RepoFullName, $defaultBranch, $RequiredCheckName)
                }
            } catch {
                Write-ManualLine ('Setting branch protection via gh api failed. Set it by hand: https://github.com/{0}/settings/branches -> Add rule for "{1}" -> require status check "{2}", enable "Do not allow bypassing the above settings", disable force pushes and branch deletion.' -f $RepoFullName, $defaultBranch, $RequiredCheckName)
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '======================================================================' -ForegroundColor Cyan
if ($DryRun) {
    Write-Host 'DRY RUN complete - nothing was created or changed.' -ForegroundColor Cyan
} else {
    Write-Host 'Bootstrap complete.' -ForegroundColor Cyan
}
Write-Host '======================================================================' -ForegroundColor Cyan

if ($script:ManualSteps.Count -gt 0) {
    Write-Host ''
    Write-Host 'Manual follow-ups (nothing above blocked on these, but they are not done yet):' -ForegroundColor Magenta
    $i = 1
    foreach ($m in $script:ManualSteps) {
        Write-Host ('  {0}. {1}' -f $i, $m)
        $i = $i + 1
    }
} else {
    Write-Host ''
    Write-Host 'No manual follow-ups were flagged.' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Always manual, by design (see kit README - "What stays manual, always"):' -ForegroundColor DarkGray
Write-Host '  - Using the product day to day.'
Write-Host '  - Writing the raw testing notes.'
Write-Host '  - Answering decision pop-ups.'
Write-Host '  - Approving UI mockups before they ship.'
Write-Host '  - Applying schema changes to a live, populated database.'
