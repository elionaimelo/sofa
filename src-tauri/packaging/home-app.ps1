# Registers Sofa as an Xbox full screen experience home app (run elevated by the installer).
# Machine-wide side effects, on purpose and documented in the README:
#   - developer mode (AppModelUnlock) so the AllowAny SCCD is accepted
#   - the Sofa self-signed certificate in LocalMachine\TrustedPeople
param([string]$InstallDir, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$cfg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GamingConfiguration'
$thumb = (Get-PfxCertificate "$PSScriptRoot\sofa-identity.cer").Thumbprint

if ($Uninstall) {
  $pkg = Get-AppxPackage -Name Sofa -ErrorAction SilentlyContinue
  if ($pkg) {
    $cur = (Get-ItemProperty $cfg -Name GamingHomeApp -ErrorAction SilentlyContinue).GamingHomeApp
    if ($cur -eq "$($pkg.PackageFamilyName)!App") { Remove-ItemProperty $cfg -Name GamingHomeApp -ErrorAction SilentlyContinue }
    Remove-AppxPackage -Package $pkg.PackageFullName
  }
  Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Thumbprint -eq $thumb | Remove-Item
  exit 0
}

# Never `New-Item -Force` an existing registry key: it replaces the key with an empty one.
$unlock = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
if (-not (Test-Path $unlock)) { New-Item $unlock | Out-Null }
Set-ItemProperty $unlock -Name AllowDevelopmentWithoutDevLicense -Value 1 -Type DWord
Set-ItemProperty $unlock -Name AllowAllTrustedApps -Value 1 -Type DWord

if (-not (Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Thumbprint -eq $thumb)) {
  Import-Certificate -FilePath "$PSScriptRoot\sofa-identity.cer" -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
}

Copy-Item "$PSScriptRoot\CustomCapability.SCCD" "$InstallDir\CustomCapability.SCCD" -Force
Add-AppxPackage -Path "$PSScriptRoot\Sofa.Identity.msix" -ExternalLocation $InstallDir -ForceUpdateFromAnyVersion

# Only claim the home app slot when none is chosen; a user's later choice is kept across updates.
$aumid = "$((Get-AppxPackage -Name Sofa).PackageFamilyName)!App"
if (-not (Test-Path $cfg)) { New-Item $cfg | Out-Null }
if (-not (Get-ItemProperty $cfg -Name GamingHomeApp -ErrorAction SilentlyContinue).GamingHomeApp) {
  Set-ItemProperty $cfg -Name GamingHomeApp -Value $aumid
}
# Boot into Xbox mode when Sofa is the home app, unless the user already set this.
# Up to 0.3.5 this script ran `New-Item -Force` on this key and wiped the value on every update.
$current = Get-ItemProperty $cfg -ErrorAction SilentlyContinue
if ($current.GamingHomeApp -eq $aumid -and $null -eq $current.StartupToGamingHome) {
  Set-ItemProperty $cfg -Name StartupToGamingHome -Value 1 -Type DWord
}
