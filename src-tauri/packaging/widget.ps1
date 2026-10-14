# Installs or repairs Sofa's Xbox Game Bar widget (run elevated: the loopback exemption needs
# admin). Called by home-app.ps1 during install/update and by Sofa's "Install widget" button.
# Every step goes to Sofa's diagnostics log so a failed install is visible in the app.
param([string]$LogPath = "$env:APPDATA\com.sofa.app\sofa.log")
$ErrorActionPreference = 'Continue'

function Log([string]$Message) {
  $seconds = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  New-Item (Split-Path $LogPath) -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
  Add-Content -Path $LogPath -Value "$seconds widget: $Message" -ErrorAction SilentlyContinue
}
function FirstLine($ErrorRecord) { "$($ErrorRecord.Exception.Message)".Split("`n")[0].Trim() }

$dir = Join-Path $PSScriptRoot 'widget'
if (-not (Test-Path "$dir\Sofa.Widget.msix")) {
  Log 'package not found in the install folder'
  exit 1
}

# Dependencies one at a time: one that Windows already has in a newer version must not fail the
# whole install (passing them all with -DependencyPath did).
foreach ($dependency in Get-ChildItem "$dir\Dependencies\*.appx" -ErrorAction SilentlyContinue) {
  try {
    Add-AppxPackage -Path $dependency.FullName -ErrorAction Stop
    Log "dependency installed: $($dependency.Name)"
  } catch {
    Log "dependency skipped: $($dependency.Name): $(FirstLine $_)"
  }
}

try {
  # Repair also works when home-app registration stopped before trusting the certificate.
  $certificate = Join-Path $PSScriptRoot 'sofa-identity.cer'
  $thumb = (Get-PfxCertificate $certificate -ErrorAction Stop).Thumbprint
  if (-not (Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Thumbprint -eq $thumb)) {
    Import-Certificate -FilePath $certificate -CertStoreLocation Cert:\LocalMachine\TrustedPeople -ErrorAction Stop | Out-Null
  }
  Add-AppxPackage -Path "$dir\Sofa.Widget.msix" -ForceUpdateFromAnyVersion -ErrorAction Stop
} catch {
  Log "install failed: $(FirstLine $_)"
  exit 1
}
$package = Get-AppxPackage -Name Sofa.Widget
if (-not $package) {
  Log 'package registration not found after installation'
  exit 1
}
Log "installed $($package.Version)"

# UWP apps can't reach 127.0.0.1 (Sofa's HUD server) without this exemption.
CheckNetIsolation.exe LoopbackExempt -a -n="$($package.PackageFamilyName)" | Out-Null
Log "loopback exemption: exit $LASTEXITCODE"
if ($LASTEXITCODE -ne 0) { exit 1 }
exit 0
