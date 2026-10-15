# Generated source releases

Status: accepted 2026-10-15.

Follow the [shared release convention](https://github.com/misty-step/harness/blob/master/docs/release-convention.md)
and [Foundations](https://foundations.mistystep.io/).

Parlor currently distributes one pinned source checkout, including its public
site. It has no registry releases or prior tags. Its release unit is the root
package; the root package version is the displayed source version. Private
workspace package manifests are not a promise of separately published packages.
Registry publishing remains a separate decision.

Adopt release-please in Node manifest mode, from explicit baseline
`55410ca45451ccca9a848f04af48162d2bf73384`. The manifest starts at the generator's
`0.0.0` no-prior-release sentinel: there are no prior release tags, and the old
static package `0.1.0` was not a published release authority. No tag or package
version is reset. The first release follows the generator's default `1.0.0`;
this does not assert npm availability. Subsequent fixes/features/breaking changes
use normal SemVer.
The generator owns the root package version, manifest and CHANGELOG.md. The
initial changelog is empty, not invented historic releases.

The existing site workflow remains the sole CI deploy lane. Only its successful,
still-current, live-read-back source may publish metadata. Its release job uses
the existing GITHUB_TOKEN, pins release-please v5.0.0, and approves the generated
PR's native Check and Gallery links runs. Missing or moved runs fail loudly;
there is no substitute passing status, dispatch-only gate, bypass, or new key.
Semantic advisory remains advisory. Squash-only merges use PR_TITLE and BLANK.

The website renders that same CHANGELOG.md at build time, serves its exact bytes
at /changelog.md, and reports the source version and full CI source at
/release.json. /version.txt retains the existing CD/rollback identity contract.
A GitHub Release is metadata, not proof of a healthy deployment. Code recovery
continues through the existing immutable-version staging drill and production
rollback; this change never writes game rooms, credentials, or production data.
