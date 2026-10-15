$ErrorActionPreference = 'Stop'
$games = @(Get-AppxPackage -PackageTypeFilter Main | ForEach-Object {
    $package = $_
    $config = Join-Path $package.InstallLocation 'MicrosoftGame.config'
    if (-not (Test-Path -LiteralPath $config -PathType Leaf)) { return }
    try {
        [xml]$game = Get-Content -LiteralPath $config -Raw
        [xml]$manifest = Get-AppxPackageManifest -Package $package.PackageFullName
        $application = @($manifest.Package.Applications.Application)[0]
        if ($null -eq $application -or [string]::IsNullOrWhiteSpace($application.Id)) { return }
        $title = [string]$game.Game.ShellVisuals.DefaultDisplayName
        if ([string]::IsNullOrWhiteSpace($title) -or $title.StartsWith('ms-resource:')) {
            $title = [string]$package.Name
        }
        [pscustomobject]@{
            family = [string]$package.PackageFamilyName
            aumid = ([string]$package.PackageFamilyName + '!' + [string]$application.Id)
            title = $title
            folder = [string]$package.InstallLocation
        }
    } catch {}
})
ConvertTo-Json -InputObject $games -Compress -Depth 3
