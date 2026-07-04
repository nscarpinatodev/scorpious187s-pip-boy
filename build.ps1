<#
    build.ps1 — package the module into a Foundry-installable module.zip
    (the same artifact the GitHub release workflow produces). Run from repo root:
        ./build.ps1
#>
param(
    [string]$Output = "module.zip"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Files/folders that make up the distributable module.
$include = @(
    "module.json",
    "scripts", "styles", "templates", "lang", "frames",
    "README.md", "LICENSE", "CHANGELOG.md"
)

$paths = $include |
    ForEach-Object { Join-Path $root $_ } |
    Where-Object { Test-Path $_ }

$zip = Join-Path $root $Output
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path $paths -DestinationPath $zip -CompressionLevel Optimal

$size = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "Built $zip ($size MB)" -ForegroundColor Green
