# Merge new <Config> entries from the stock template into a my-* Unraid template (keeps your values).
param(
    [Parameter(Mandatory = $true)]
    [string]$MyTemplatePath,
    [Parameter(Mandatory = $true)]
    [string]$BaseTemplatePath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $MyTemplatePath)) {
    Write-Error "My template not found: $MyTemplatePath"
}
if (-not (Test-Path $BaseTemplatePath)) {
    Write-Error "Base template not found: $BaseTemplatePath"
}

$myContent = Get-Content $MyTemplatePath -Raw
$baseContent = Get-Content $BaseTemplatePath -Raw

function Get-ConfigTargets {
    param([string]$Xml)
    [regex]::Matches($Xml, 'Target="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
}

function Get-ConfigBlocks {
    param([string]$Xml)
    [regex]::Matches($Xml, '(?m)^  <Config [^>]+(?:/>|>[^<]*</Config>)\s*$') | ForEach-Object { $_.Value }
}

$myTargets = [System.Collections.Generic.HashSet[string]]::new([string[]](Get-ConfigTargets $myContent))
$baseBlocks = Get-ConfigBlocks $baseContent
$added = 0

$insertBefore = '  <Config Name="Puppeteer Skip Download"'
$insertIndex = $myContent.IndexOf($insertBefore)
if ($insertIndex -lt 0) {
    $insertBefore = '  <TailscaleStateDir/>'
    $insertIndex = $myContent.IndexOf($insertBefore)
}
if ($insertIndex -lt 0) {
    $insertIndex = $myContent.LastIndexOf('</Container>')
}

$newLines = @()
foreach ($block in $baseBlocks) {
    if ($block -match 'Target="([^"]+)"') {
        $target = $Matches[1]
        if (-not $myTargets.Contains($target)) {
            $newLines += $block
            $myTargets.Add($target) | Out-Null
            $added++
        }
    }
}

if ($added -eq 0) {
    Write-Host "No new config fields to merge into $(Split-Path $MyTemplatePath -Leaf)." -ForegroundColor Green
    exit 0
}

$chunk = ($newLines -join "`n") + "`n"
if ($insertIndex -ge 0) {
    $myContent = $myContent.Insert($insertIndex, $chunk)
} else {
    Write-Error "Could not find insertion point in $MyTemplatePath"
}

# Write UTF-8 without BOM explicitly so em-dashes/unicode survive across
# PowerShell versions (default Set-Content encoding varies and can corrupt them).
[System.IO.File]::WriteAllText($MyTemplatePath, $myContent, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Merged $added new config field(s) into $(Split-Path $MyTemplatePath -Leaf)." -ForegroundColor Green
