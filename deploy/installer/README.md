# Installer hosting

Publish the following files below `https://metis-ai.f1shy312.com/install/`:

| URL | Source |
| --- | --- |
| `/linux` | `deploy/installer/linux` |
| `/macos` | `deploy/installer/macos` |
| `/windows` | `deploy/installer/windows` |
| `/install.sh` | `scripts/install.sh` |
| `/install.ps1` | `scripts/install.ps1` |

The bootstrap files intentionally contain no credentials. The application
source remains private; the installer obtains it through authenticated `gh`,
`GITHUB_TOKEN`, a release archive URL, or a local source directory.

Keep this directory on the private deployment's static host. Do not put
private GitHub tokens in these files.
