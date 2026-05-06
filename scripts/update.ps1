# ==============================================================================
# Universal Lookup Update & Deploy Script
# ==============================================================================
# Automates: Git Push -> Docker Build -> Docker Push -> Unraid Template Deploy
# ==============================================================================

param (
    [string]$CommitMessage = "chore: update and redeploy",
    [string]$NasTemplatePath = "\\UNRAID\flash\config\plugins\dockerGui\templates-user",
    [ValidateSet("patch", "minor", "major", "none")]
    [string]$Bump = "patch"
)

$ErrorActionPreference = "Stop"

# 1. Version Bumping
Write-Host "🔍 Reading version from package.json..." -ForegroundColor Cyan
$packageJson = Get-Content package.json -Raw | ConvertFrom-Json
$version = $packageJson.version

if ($Bump -ne "none") {
    Write-Host "🆙 Bumping $Bump version..." -ForegroundColor Cyan
    $versionParts = $version.Split('.')
    switch ($Bump) {
        "major" { $versionParts[0] = [int]$versionParts[0] + 1; $versionParts[1] = 0; $versionParts[2] = 0 }
        "minor" { $versionParts[1] = [int]$versionParts[1] + 1; $versionParts[2] = 0 }
        "patch" { $versionParts[2] = [int]$versionParts[2] + 1 }
    }
    $version = $versionParts -join '.'
    $packageJson.version = $version
    $packageJson | ConvertTo-Json -Depth 10 | Set-Content package.json
    Write-Host "✅ Bumped to $version" -ForegroundColor Green
} else {
    Write-Host "🚀 Version: $version (no bump)" -ForegroundColor Green
}

# 2. Git Operations
Write-Host "📦 Committing changes to Git..." -ForegroundColor Cyan
git add .
git commit -m $CommitMessage
git push
Write-Host "✅ Git push complete." -ForegroundColor Green

# 3. Docker Build
Write-Host "🏗️ Building Docker images..." -ForegroundColor Cyan
$tags = @(
    "ghcr.io/bluscream/universal-lookup:latest",
    "ghcr.io/bluscream/universal-lookup:$version",
    "bluscream1/universal-lookup:latest",
    "bluscream1/universal-lookup:$version"
)

$buildCmd = "docker build "
foreach ($tag in $tags) { $buildCmd += "-t $tag " }
$buildCmd += "."
Invoke-Expression $buildCmd

# 4. Docker Push
Write-Host "📤 Pushing images to registries..." -ForegroundColor Cyan
foreach ($tag in $tags) {
    Write-Host "Pushing $tag..." -ForegroundColor Gray
    docker push $tag
}
Write-Host "✅ Docker push complete." -ForegroundColor Green

# 5. Unraid Template Deploy
if (Test-Path $NasTemplatePath) {
    Write-Host "💾 Deploying XML templates to NAS..." -ForegroundColor Cyan
    Copy-Item "unraid\*.xml" $NasTemplatePath -Force
    Write-Host "✅ Templates copied to $NasTemplatePath" -ForegroundColor Green
} else {
    Write-Warning "NAS template path not found: $NasTemplatePath"
    Write-Host "Skipping NAS upload. Please ensure your Unraid flash drive is mounted or update the path in this script." -ForegroundColor Yellow
}

Write-Host "`n✨ All tasks completed successfully!" -ForegroundColor Green -BackgroundColor Black
