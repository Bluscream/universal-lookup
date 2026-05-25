# One-off: verify npm auth and publish (run from repo root)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if ($env:ChocolateyInstall -and (Test-Path "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1")) {
    Import-Module "$env:ChocolateyInstall\helpers\chocolateyProfile.psm1"
    refreshenv | Out-Null
}

# Prefer User env (process env may still hold an expired token until terminal restart)
$userToken = [Environment]::GetEnvironmentVariable('NPM_TOKEN', 'User')
if ($userToken) {
    $env:NPM_TOKEN = $userToken
}
if (-not $env:NPM_TOKEN) {
    Write-Host 'NPM_TOKEN not set. Set it in User env or: $env:NPM_TOKEN = "npm_..."' -ForegroundColor Red
    exit 1
}

Set-Content -Path '.npmrc' -Value "//registry.npmjs.org/:_authToken=$($env:NPM_TOKEN)"
try {
    Write-Host 'npm whoami...' -ForegroundColor Cyan
    npm whoami
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host 'npm run build...' -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host 'npm publish --access public...' -ForegroundColor Cyan
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    npm publish --access public 2>&1 | Out-Host
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    exit $code
} finally {
    Remove-Item '.npmrc' -Force -ErrorAction SilentlyContinue
}
