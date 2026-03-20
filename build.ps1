# build.ps1 — Upwork Wizard Obfuscated Build
# Run from PowerShell: ./build.ps1

$ErrorActionPreference = "Stop"

$SOURCE = "C:\Users\PC\Documents\coding_lab\SandBox\upwork auto"
$DIST   = "$SOURCE\dist"
$ERRORS = @()

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Upwork Wizard -- Obfuscated Build"      -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# ── Check tools ───────────────────────────────────────────────
Write-Host "Checking required tools..." -ForegroundColor Gray
$tools = @{
    "clean-css-cli"         = "npm install -g clean-css-cli"
    "html-minifier-terser"  = "npm install -g html-minifier-terser"
    "javascript-obfuscator" = "npm install -g javascript-obfuscator"
}
foreach ($tool in $tools.Keys) {
    $null = npx $tool --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [MISSING] $tool  =>  $($tools[$tool])" -ForegroundColor Red
        $ERRORS += $tool
    } else {
        Write-Host "  [OK] $tool" -ForegroundColor Green
    }
}
if ($ERRORS.Count -gt 0) {
    Write-Host ""
    Write-Host "Install missing tools above, then re-run." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ""

# ── Helper functions ──────────────────────────────────────────
function Step($n, $msg) {
    Write-Host "[$n/6] $msg" -ForegroundColor Yellow
}
function OK($file) {
    Write-Host "  OK: $file" -ForegroundColor Green
}
function Fail($file, $msg) {
    Write-Host "  FAILED: $file  --  $msg" -ForegroundColor Red
    $script:ERRORS += $file
}

# ── [1] Clean dist ────────────────────────────────────────────
Step 1 "Cleaning previous dist..."
if (Test-Path $DIST) { Remove-Item -Recurse -Force $DIST }

# ── [2] Create structure ──────────────────────────────────────
Step 2 "Creating dist folder structure..."
New-Item -ItemType Directory -Force "$DIST\scripts" | Out-Null

# ── [3] Copy manifest + supabase as-is ───────────────────────
Step 3 "Copying manifest and supabase client..."
Copy-Item "$SOURCE\manifest.json"           "$DIST\manifest.json"
Copy-Item "$SOURCE\scripts\supabase.min.js" "$DIST\scripts\supabase.min.js"
OK "manifest.json"
OK "supabase.min.js"

# ── [4] Minify CSS ────────────────────────────────────────────
Step 4 "Minifying CSS..."
try {
    npx clean-css-cli "$SOURCE\style.css" -o "$DIST\style.css"
    if ($LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE" }
    OK "style.css"
} catch { Fail "style.css" $_ }

# ── [5] Minify HTML ───────────────────────────────────────────
Step 5 "Minifying HTML..."
$htmlFiles = @("ui.html", "overlay-auth.html", "overlay-dashboard.html", "popup.html")
foreach ($f in $htmlFiles) {
    try {
        npx html-minifier-terser "$SOURCE\$f" `
            --output "$DIST\$f" `
            --collapse-whitespace `
            --remove-comments `
            --remove-optional-tags `
            --remove-redundant-attributes `
            --remove-script-type-attributes `
            --remove-tag-whitespace `
            --use-short-doctype `
            --minify-css true `
            --minify-js true
        if ($LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE" }
        OK $f
    } catch { Fail $f $_ }
}

# ── [6] Obfuscate JS ──────────────────────────────────────────
Step 6 "Obfuscating JS files..."

$scriptFiles = @("auth.js", "automator.js", "human.js", "main.js", "parser.js")
foreach ($f in $scriptFiles) {
    try {
        npx javascript-obfuscator "$SOURCE\scripts\$f" `
            --output "$DIST\scripts\$f" `
            --compact true `
            --control-flow-flattening true `
            --control-flow-flattening-threshold 0.75 `
            --dead-code-injection true `
            --dead-code-injection-threshold 0.4 `
            --string-array true `
            --string-array-encoding rc4 `
            --string-array-threshold 0.75 `
            --split-strings true `
            --split-strings-chunk-length 10 `
            --disable-console-output true `
            --rename-globals false `
            --self-defending true `
            --target browser-no-eval
        if ($LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE" }
        OK $f
    } catch { Fail $f $_ }
}

try {
    npx javascript-obfuscator "$SOURCE\popup.js" `
        --output "$DIST\popup.js" `
        --compact true `
        --control-flow-flattening true `
        --control-flow-flattening-threshold 0.75 `
        --dead-code-injection true `
        --string-array true `
        --string-array-encoding rc4 `
        --disable-console-output true `
        --rename-globals false `
        --self-defending true `
        --target browser-no-eval
    if ($LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE" }
    OK "popup.js"
} catch { Fail "popup.js" $_ }

# ── Summary ───────────────────────────────────────────────────
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
if ($ERRORS.Count -eq 0) {
    Write-Host "  BUILD SUCCESSFUL" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Output: $DIST" -ForegroundColor White
    Write-Host ""
    Write-Host "File sizes:" -ForegroundColor Gray
    $allFiles = @(
        "$DIST\style.css",
        "$DIST\ui.html",
        "$DIST\overlay-auth.html",
        "$DIST\overlay-dashboard.html",
        "$DIST\popup.html",
        "$DIST\popup.js",
        "$DIST\scripts\auth.js",
        "$DIST\scripts\automator.js",
        "$DIST\scripts\human.js",
        "$DIST\scripts\main.js",
        "$DIST\scripts\parser.js"
    )
    foreach ($f in $allFiles) {
        if (Test-Path $f) {
            $size = (Get-Item $f).Length
            $name = Split-Path $f -Leaf
            Write-Host ("  {0,-35} {1,8} bytes" -f $name, $size) -ForegroundColor Gray
        }
    }
    Write-Host ""
    Write-Host "Load in Chrome:" -ForegroundColor White
    Write-Host "  chrome://extensions > Developer Mode > Load unpacked > select dist\" -ForegroundColor Gray
} else {
    Write-Host "  BUILD COMPLETED WITH ERRORS" -ForegroundColor Red
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Failed files:" -ForegroundColor Red
    foreach ($e in $ERRORS) { Write-Host "  - $e" -ForegroundColor Red }
}
Write-Host ""
Read-Host "Press Enter to exit"
