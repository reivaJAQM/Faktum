$ErrorActionPreference = 'Stop'

$Repo = 'reivaJAQM/Faktum'
$AppName = 'Faktum'
$AssetName = 'Faktum-win-x64.zip'
$DownloadUrl = "https://github.com/$Repo/releases/latest/download/$AssetName"
$InstallDir = Join-Path $env:LOCALAPPDATA $AppName
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("faktum-install-" + [Guid]::NewGuid().ToString('N'))
$ZipPath = Join-Path $TempDir $AssetName
$ExtractDir = Join-Path $TempDir 'extract'

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

try {
  Write-Host "Instalando $AppName..."

  # Cerrar instancia activa si se está actualizando
  Get-Process -Name $AppName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400

  New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null

  Write-Host "Descargando $AssetName..."
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -UseBasicParsing

  Write-Host "Extrayendo archivos..."
  Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force

  $SourceDir = $ExtractDir
  if (!(Test-Path (Join-Path $SourceDir "$AppName.exe"))) {
    $ExeFile = Get-ChildItem -Path $ExtractDir -Filter "$AppName.exe" -Recurse | Select-Object -First 1
    if ($null -eq $ExeFile) {
      throw "No se encontró $AppName.exe dentro del paquete descargado."
    }
    $SourceDir = $ExeFile.DirectoryName
  }

  if (Test-Path $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

  Copy-Item -Path (Join-Path $SourceDir '*') -Destination $InstallDir -Recurse -Force
  Get-ChildItem -Path $InstallDir -Recurse -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

  $ExePath = Join-Path $InstallDir "$AppName.exe"
  if (!(Test-Path $ExePath)) {
    throw "No se pudo completar la instalación en $InstallDir."
  }

  $WshShell = New-Object -ComObject WScript.Shell
  $ShortcutTargets = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"),
    (Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk")
  )

  foreach ($LnkPath in $ShortcutTargets) {
    $LnkDir = Split-Path -Parent $LnkPath
    if (!(Test-Path $LnkDir)) {
      New-Item -ItemType Directory -Path $LnkDir -Force | Out-Null
    }
    $Shortcut = $WshShell.CreateShortcut($LnkPath)
    $Shortcut.TargetPath = $ExePath
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.IconLocation = "$ExePath,0"
    $Shortcut.Description = 'Faktum — Comprobantes electrónicos del SRI'
    $Shortcut.Save()
  }

  Write-Host "Faktum instalado correctamente en: $InstallDir"
  Write-Host "Accesos directos creados en Escritorio y Menú Inicio."
} finally {
  if (Test-Path $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
