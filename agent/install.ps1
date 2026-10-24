# Moonlight agent installer for Windows:
#   irm https://moonlight.hajunshin.com/install.ps1 | iex
# Puts moonlight.exe in %LOCALAPPDATA%\Moonlight\bin (override with MOONLIGHT_INSTALL_DIR) and adds it to your PATH.
$ErrorActionPreference = 'Stop'

$base = if ($env:MOONLIGHT_URL) { $env:MOONLIGHT_URL } else { 'https://moonlight.hajunshin.com' }
$dir = if ($env:MOONLIGHT_INSTALL_DIR) { $env:MOONLIGHT_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Moonlight\bin' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Moonlight needs 64-bit Windows.' }
$arch = 'x64' # Windows on Arm runs the x64 build under emulation.

New-Item -ItemType Directory -Force -Path $dir | Out-Null
$exe = Join-Path $dir 'moonlight.exe'
Write-Host "Downloading Moonlight for windows-$arch..."
$ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest many times slower
Invoke-WebRequest -Uri "$base/dl/moonlight-windows-$arch.exe" -OutFile "$exe.download" -UseBasicParsing
Move-Item -Force "$exe.download" $exe
Unblock-File $exe

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$added = $false
if (-not (($userPath -split ';') -contains $dir)) {
  $newPath = if ($userPath) { "$userPath;$dir" } else { $dir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  $env:Path = "$env:Path;$dir"
  $added = $true
}

Write-Host "Installed $(& $exe --version) at $exe"
if ($added) { Write-Host "Added $dir to your PATH. New terminals will find 'moonlight' too." }
Write-Host ''
Write-Host 'Next:'
Write-Host '  1. Install Ollama (https://ollama.com) and pull a model:  ollama pull qwen2.5:7b'
Write-Host '  2. Connect this computer:  moonlight'
