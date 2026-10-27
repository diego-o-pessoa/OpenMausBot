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
    # On a busy machine the process tree can take well over 15 s to exit after taskkill.
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Process -Name OpenMausBot -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
        & taskkill.exe /F /T /IM OpenMausBot.exe 2>$null | Out-Null
        Start-Sleep -Seconds 1
    }
    if (Get-Process -Name OpenMausBot -ErrorAction SilentlyContinue) { throw "Nao foi possivel fechar o OpenMausBot." }
}

$dados = Join-Path $env:USERPROFILE ".openmausbot"
if (Test-Path -LiteralPath $dados) {
    $backups = Join-Path $env:USERPROFILE "OpenMausBot-backups"
    $destino = Join-Path $backups (Get-Date -Format "yyyy-MM-dd_HHmmss")
    Write-Host "Backup dos agentes em $destino..."
    # Task workspaces link skills in with junctions whose targets are already under $dados or may be gone.
    & robocopy.exe $dados $destino /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    # robocopy: 0-7 is success, 8 or more is failure.
    if ($LASTEXITCODE -ge 8) { throw "O backup falhou (robocopy $LASTEXITCODE). Nada foi instalado." }
    $global:LASTEXITCODE = 0
    Get-ChildItem -LiteralPath $backups -Directory | Sort-Object Name -Descending | Select-Object -Skip 5 | Remove-Item -Recurse -Force
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
