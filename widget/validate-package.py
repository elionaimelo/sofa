"""Reject widget bundles whose shipped frameworks cannot satisfy their manifests."""

import argparse
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile


def read_manifest(path):
    with zipfile.ZipFile(path) as package:
        return ET.fromstring(package.read("AppxManifest.xml"))


def version(value):
    return tuple(int(part) for part in value.split("."))


def validate(directory):
    paths = [directory / "Sofa.Widget.msix", *sorted((directory / "Dependencies").glob("*.appx"))]
    packages = [(path, read_manifest(path)) for path in paths]
    identities = [manifest.find("{*}Identity").attrib for _, manifest in packages]
    errors = []
    for (path, manifest), identity in zip(packages, identities):
        for dependency in manifest.findall("{*}Dependencies/{*}PackageDependency"):
            required = dependency.attrib
            architecture = required.get("ProcessorArchitecture", identity["ProcessorArchitecture"])
            candidates = [
                item for item in identities
                if item["Name"] == required["Name"]
                and item["Publisher"] == required["Publisher"]
                and item["ProcessorArchitecture"] in (architecture, "neutral")
            ]
            minimum = required.get("MinVersion", "0.0.0.0")
            if not any(version(item["Version"]) >= version(minimum) for item in candidates):
                shipped = ", ".join(item["Version"] for item in candidates) or "missing"
                errors.append(f"{path.name}: {required['Name']} requires >= {minimum}; bundled: {shipped}")
    if errors:
        raise ValueError("\n".join(errors))
    print(f"Validated {len(packages)} packages: all framework dependencies are bundled.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    try:
        validate(args.directory)
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        parser.exit(1, f"Widget package validation failed:\n{error}\n")
