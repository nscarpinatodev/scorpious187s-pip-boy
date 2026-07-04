<#
    deploy.ps1 — copy the module into the local Foundry data folder so it can be
    loaded/reloaded in-app. Run from the repo root:  ./deploy.ps1
#>
param(
    [string]$FoundryData = "$env:LOCALAPPDATA\FoundryVTT\Data"
)

$ErrorActionPreference = "Stop"
$moduleId = "scorpious187s-pip-boy"
$src      = $PSScriptRoot
$dest     = Join-Path $FoundryData "modules\$moduleId"

if (-not (Test-Path $FoundryData)) {
    throw "Foundry data folder not found at '$FoundryData'. Pass -FoundryData <path>."
}

# Files/folders that make up the installable module.
$include = @("module.json", "scripts", "styles", "templates", "lang", "frames")

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null

foreach ($item in $include) {
    $path = Join-Path $src $item
    if (Test-Path $path) {
        Copy-Item $path -Destination $dest -Recurse -Force
    } else {
        Write-Warning "Skipping missing item: $item"
    }
}

Write-Host "Deployed '$moduleId' to $dest" -ForegroundColor Green
Write-Host "In Foundry: reload (F5) at the Setup screen, or 'Return to Setup' then relaunch the world." -ForegroundColor Cyan
