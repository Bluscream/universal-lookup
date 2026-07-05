# ==============================================================================
# Universal Lookup Update & Deploy Script
# ==============================================================================
# Automates: Git Push -> Docker Build -> Docker Push -> Unraid Template Deploy
# ==============================================================================

param (
    [string]$CommitMessage = "update",
    [string]$NasTemplatePath = "\\UNRAID\flash\config\plugins\dockerMan\templates-user",
    [ValidateSet("patch", "minor", "major", "none")]
    [string]$Bump = "patch",
    [switch]$IgnoreWarnings,
    [switch]$IgnoreErrors,
    [switch]$SkipDocker,
    [switch]$SkipNpm
)

if ($IgnoreErrors) {
    $ErrorActionPreference = "Continue"
} else {
    $ErrorActionPreference = "Stop"
}

# Ensure we are in the project root
if (-not (Test-Path "package.json")) {
    Write-Host "Error: package.json not found. Please run this script from the project root." -ForegroundColor Red
    exit 1
}

# Helper to run npm scripts with validation
function Invoke-ProjectStep {
    param (
        [string]$Name,
        [string]$Command
    )
    Write-Host "$Name ($Command)..." -ForegroundColor Cyan
    
    # Biome writes diagnostics to stderr; only fail on exit code, not stderr noise
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    npm run $Command 2>&1 | Out-Host
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($exitCode -ne 0) {
        if ($IgnoreErrors) {
            Write-Host "$Name failed (Exit Code: $exitCode) but IgnoreErrors is set. Continuing..." -ForegroundColor Yellow
        } else {
            Write-Host "$Name failed (Exit Code: $exitCode)" -ForegroundColor Red
            exit $exitCode
        }
    } else {
        Write-Host "$Name passed" -ForegroundColor Green
    }
}


# 1. Quality Assurance (Lint, Build, Test)
Write-Host "Running QA checks..." -ForegroundColor Cyan
Invoke-ProjectStep -Name "Linter" -Command "lint"
Invoke-ProjectStep -Name "Tests" -Command "test"

# 2. Version Bumping
Write-Host "Reading version from package.json..." -ForegroundColor Cyan
$packageJson = Get-Content package.json -Raw | ConvertFrom-Json
$version = $packageJson.version

if ($Bump -ne "none") {
    Write-Host "Bumping $Bump version..." -ForegroundColor Cyan
    $versionParts = $version.Split('.')
    switch ($Bump) {
        "major" { $versionParts[0] = [int]$versionParts[0] + 1; $versionParts[1] = 0; $versionParts[2] = 0 }
        "minor" { $versionParts[1] = [int]$versionParts[1] + 1; $versionParts[2] = 0 }
        "patch" { $versionParts[2] = [int]$versionParts[2] + 1 }
    }
    $version = $versionParts -join '.'
    $packageJson.version = $version
    $packageJson | ConvertTo-Json -Depth 10 | Set-Content package.json
    Write-Host "Bumped to $version" -ForegroundColor Green
} else {
    Write-Host "Version: $version (no bump)" -ForegroundColor Green
}

Invoke-ProjectStep -Name "Compiler" -Command "build"

# 3. Git Operations
Write-Host "Committing changes to Git..." -ForegroundColor Cyan
git add .
git commit -m $CommitMessage
git push
Write-Host "Git push complete." -ForegroundColor Green

if (-not $SkipDocker) {
    # 4. Docker Build
    Write-Host "Building Docker images..." -ForegroundColor Cyan
    $tags = @(
        "ghcr.io/bluscream/universal-lookup:latest",
        "ghcr.io/bluscream/universal-lookup:$version",
        "bluscream1/universal-lookup:latest",
        "bluscream1/universal-lookup:$version"
    )

    # Check for buildx (rely on exit code; `docker buildx version` output does
    # not contain the literal word "version")
    $hasBuildx = $false
    try {
        docker buildx version *> $null
        if ($LASTEXITCODE -eq 0) { $hasBuildx = $true }
    } catch {
        $hasBuildx = $false
    }

    if ($hasBuildx) {
        Write-Host "Using Docker Buildx for multi-arch support (linux/amd64, linux/arm64)..." -ForegroundColor Magenta

        # Reuse the builder if it already exists, otherwise create it. Calling
        # `create` on an existing builder errors ("no append mode"), so prefer
        # `use` first and only create when that fails.
        docker buildx use universal-builder 2>$null
        if ($LASTEXITCODE -ne 0) {
            docker buildx create --use --name universal-builder 2>$null
        }

        # Build an argument array so each -t is a separate token (a single
        # interpolated string is treated as one invalid tag reference).
        # amd64 (servers/unraid) + arm64 (Pi/Apple Silicon); the Chromium image is
        # untested on arm/v7 and 386, and buildx pushes atomically, so keep to these.
        $buildArgs = @('buildx', 'build', '--platform', 'linux/amd64,linux/arm64')
        foreach ($tag in $tags) { $buildArgs += '-t'; $buildArgs += $tag }
        $buildArgs += '--push'
        $buildArgs += '.'
        docker @buildArgs
        Write-Host "Docker buildx build and push complete." -ForegroundColor Green
    } else {
        Write-Host "Docker Buildx not found. Falling back to legacy build (single architecture)..." -ForegroundColor Yellow
        $buildCmd = "docker build "
        foreach ($tag in $tags) { $buildCmd += "-t $tag " }
        $buildCmd += "."
        Invoke-Expression $buildCmd
        
        # 5. Docker Push (Legacy)
        Write-Host "Pushing images to registries..." -ForegroundColor Cyan
        foreach ($tag in $tags) {
            Write-Host "Pushing $tag..." -ForegroundColor Gray
            docker push $tag
        }
        Write-Host "Docker push complete." -ForegroundColor Green
    }
} else {
    Write-Host "Skipping Docker build and push." -ForegroundColor Yellow
}

# 6. Unraid Template Deploy
# Stock templates: unraid/*.xml -> templates-user/universal-lookup*.xml
# Running containers use my-* templates (Unraid prefix for installed/customized containers).
# Fall back to the locally-mounted flash (N:) if the SMB path isn't reachable.
if (-not (Test-Path $NasTemplatePath)) {
    $localFlash = "N:\boot\config\plugins\dockerMan\templates-user"
    if (Test-Path $localFlash) {
        Write-Host "NAS SMB path not found; using mounted flash: $localFlash" -ForegroundColor Yellow
        $NasTemplatePath = $localFlash
    }
}
if (Test-Path $NasTemplatePath) {
    Write-Host "Copying stock XML templates to NAS..." -ForegroundColor Cyan
    Copy-Item "unraid\universal-lookup.xml" $NasTemplatePath -Force
    Copy-Item "unraid\universal-lookup-tailscale.xml" $NasTemplatePath -Force
    Write-Host "Stock templates copied to $NasTemplatePath" -ForegroundColor Green
    $myTemplate = Join-Path $NasTemplatePath "my-universal-lookup.xml"
    if (Test-Path $myTemplate) {
        Write-Host "Merging new fields into my-universal-lookup.xml (preserving your settings)..." -ForegroundColor Cyan
        & "$PSScriptRoot\merge-unraid-my-template.ps1" -MyTemplatePath $myTemplate -BaseTemplatePath "unraid\universal-lookup.xml"
    } else {
        Write-Host "No my-universal-lookup.xml on NAS; only stock templates were updated." -ForegroundColor Yellow
    }
} else {
    Write-Warning "NAS template path not found: $NasTemplatePath"
    Write-Host "Skipping NAS upload. Mount \\UNRAID\flash\... or run: .\scripts\merge-unraid-my-template.ps1 then upload my-universal-lookup.xml via SSH." -ForegroundColor Yellow
}

# 7. NPM Publish
if (-not $SkipNpm) {
    if ($env:ChocolateyInstall -and (Test-Path "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1")) {
        Import-Module "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1"
        refreshenv | Out-Null
    }
    $userToken = [Environment]::GetEnvironmentVariable("NPM_TOKEN", "User")
    if ($userToken) {
        $env:NPM_TOKEN = $userToken
    }

    if ($env:NPM_TOKEN) {
        Write-Host "Publishing to npm..." -ForegroundColor Cyan
        # Create .npmrc with token
        Set-Content -Path ".npmrc" -Value "//registry.npmjs.org/:_authToken=$($env:NPM_TOKEN)"
        try {
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            npm publish --access public 2>&1 | Out-Host
            $publishExit = $LASTEXITCODE
            $ErrorActionPreference = $prevEap
            if ($publishExit -ne 0) {
                if ($IgnoreErrors) {
                    Write-Host "npm publish failed (Exit Code: $publishExit) but IgnoreErrors is set. Continuing..." -ForegroundColor Yellow
                } else {
                    Write-Host "npm publish failed (Exit Code: $publishExit). Check NPM_TOKEN is valid and belongs to package maintainer 'bluscream1'." -ForegroundColor Red
                    exit $publishExit
                }
            } else {
                Write-Host "npm publish complete." -ForegroundColor Green
            }
        } finally {
            Remove-Item ".npmrc" -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "NPM_TOKEN not found in environment. Skipping npm publish." -ForegroundColor Yellow
    }
} else {
    Write-Host "Skipping npm publish." -ForegroundColor Yellow
}

Write-Host "All tasks completed successfully!" -ForegroundColor Green
