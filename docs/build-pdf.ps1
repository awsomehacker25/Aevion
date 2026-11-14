# Regenerates docs/master-plan.pdf from docs/master-plan.html using headless Edge or Chrome.
$ErrorActionPreference = "Stop"
$docs = $PSScriptRoot
$html = Join-Path $docs "master-plan.html"
$pdf  = Join-Path $docs "master-plan.pdf"

$candidates = @(
  "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "Edge or Chrome not found." }

$uri = ([System.Uri]$html).AbsoluteUri
$ErrorActionPreference = "Continue"  # Edge/Chrome write harmless warnings to stderr
& $browser --headless=new --disable-gpu --no-pdf-header-footer "--print-to-pdf=$pdf" $uri 2>&1 | Out-Null
$ErrorActionPreference = "Stop"
Start-Sleep -Seconds 2
if (-not (Test-Path $pdf)) { throw "PDF was not created." }
Write-Host "Wrote $pdf"
