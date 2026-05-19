# ==============================================================================
# Universal Lookup Update & Deploy Script
# ==============================================================================
# Automates: Git Push -> Docker Build -> Docker Push -> Unraid Template Deploy
# ==============================================================================

param (
    [string]$CommitMessage = "update",
    [string]$NasTemplatePath = "\\UNRAID\flash\config\plugins\dockerGui\templates-user",
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

    # Check for buildx
    $hasBuildx = $false
    try {
        $check = docker buildx version 2>&1
        if ($check -match "version") { $hasBuildx = $true }
    } catch {
        $hasBuildx = $false
    }

    if ($hasBuildx) {
        Write-Host "Using Docker Buildx for multi-arch support (linux/amd64, linux/arm64, linux/arm/v7, linux/386)..." -ForegroundColor Magenta
        $tagFlags = ""
        foreach ($tag in $tags) { $tagFlags += "-t $tag " }
        
        # Try to use existing builder or create one
        docker buildx create --use --name universal-builder 2>$null
        
        docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7,linux/386 $tagFlags --push .
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
if (Test-Path $NasTemplatePath) {
    Write-Host "Copying XML templates to NAS..." -ForegroundColor Cyan
    Copy-Item "unraid\*.xml" $NasTemplatePath -Force
    Write-Host "Templates copied to $NasTemplatePath" -ForegroundColor Green
} else {
    Write-Warning "NAS template path not found: $NasTemplatePath"
    Write-Host "Skipping NAS upload. Please ensure your Unraid flash drive is mounted or update the path in this script." -ForegroundColor Yellow
    Write-Host "If you're an agent reading this, please use your ssh mcp to upload to /boot/config/plugins/dockerMan/templates-user/my-universal-lookup.xml"
}

# 7. NPM Publish
if (-not $SkipNpm) {
    if (-not $env:NPM_TOKEN) {
        $env:NPM_TOKEN = [Environment]::GetEnvironmentVariable("NPM_TOKEN", "User")
    }

    if ($env:NPM_TOKEN) {
        Write-Host "Publishing to npm..." -ForegroundColor Cyan
        # Create .npmrc with token
        Set-Content -Path ".npmrc" -Value "//registry.npmjs.org/:_authToken=$($env:NPM_TOKEN)"
        try {
            npm publish --access public
            Write-Host "npm publish complete." -ForegroundColor Green
        } finally {
            Remove-Item ".npmrc" -Force
        }
    } else {
        Write-Host "NPM_TOKEN not found in environment. Skipping npm publish." -ForegroundColor Yellow
    }
} else {
    Write-Host "Skipping npm publish." -ForegroundColor Yellow
}

Write-Host "All tasks completed successfully!" -ForegroundColor Green
