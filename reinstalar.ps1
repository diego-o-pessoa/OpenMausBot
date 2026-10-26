param([switch]$SemBuild)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not $SemBuild) {
    $previousNodeOptions = $env:NODE_OPTIONS
    $packageExitCode = 0
    try {
        $env:NODE_OPTIONS = '--max-old-space-size=4096'
        pnpm package:win
        $packageExitCode = $LASTEXITCODE
    } finally {
        if ($null -eq $previousNodeOptions) {
            Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
        } else {
            $env:NODE_OPTIONS = $previousNodeOptions
        }
    }
    if ($packageExitCode -ne 0) { throw "pnpm package:win falhou (codigo $packageExitCode)." }
}

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installer = Join-Path $PSScriptRoot "release\OpenMausBot-$version-setup.exe"
if (-not (Test-Path -LiteralPath $installer)) { throw "Instalador nao encontrado: $installer" }
foreach ($required in 'server\index.js', 'ui\index.html') {
    $path = Join-Path $PSScriptRoot "release\win-unpacked\resources\$required"
    if (-not (Test-Path -LiteralPath $path)) { throw "Build incompleto, falta $path" }
}

$running = @(Get-Process -Name OpenMausBot -ErrorAction SilentlyContinue)
if ($running.Count) {
    Write-Host "Fechando o OpenMausBot..."
    $running | ForEach-Object { [void]$_.CloseMainWindow() }
    $running | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue
    # The window, renderer, GPU and server are all OpenMausBot.exe: end the whole tree, or the main process
    # survives without its renderer and shows a blank window.
    & taskkill.exe /F /T /IM OpenMausBot.exe | Out-Null
    Get-Process -Name OpenMausBot -ErrorAction SilentlyContinue | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue
    if (Get-Process -Name OpenMausBot -ErrorAction SilentlyContinue) { throw "Nao foi possivel fechar o OpenMausBot." }
}

Write-Host "Instalando OpenMausBot $version..."
$setup = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "O instalador terminou com codigo $($setup.ExitCode)." }

$exe = Join-Path $env:LOCALAPPDATA 'Programs\OpenMausBot\OpenMausBot.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "App instalado nao encontrado em $exe" }
Write-Host "Abrindo o OpenMausBot..."
# VS Code terminals export ELECTRON_RUN_AS_NODE=1, which makes OpenMausBot.exe start as plain Node and exit.
# Explorer starts it with the user's clean environment, detached from this shell.
Start-Process -FilePath explorer.exe -ArgumentList "`"$exe`""
