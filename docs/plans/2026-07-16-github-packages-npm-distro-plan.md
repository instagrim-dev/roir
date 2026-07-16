# GitHub Packages npm distro follow-up plan

Status: deferred

## Decision

Integrate GitHub Packages npm as a secondary, repo-native distribution lane for
ROI, not as the primary public install path.

Keep the current release lane as canonical for now:

- `pnpm run release:check`
- `pnpm pack`
- checksum
- GitHub Release asset handoff

## Rationale

GitHub Packages is useful for provenance, organization/internal consumption, and
CI-to-CI installs tied to `instagrim-dev/roir`. It is not ideal as ROI's only
public package channel because GitHub's npm registry requires authentication for
package install workflows, including public packages. That creates avoidable
friction for general users compared with a tarball release or eventual npmjs
publication.

If ROI needs broad public npm-style install ergonomics, prefer npmjs with trusted
publishing/OIDC as the public lane. Use GitHub Packages as the internal/canary
lane.

## Future implementation slice

1. Choose the package identity:
   - likely `@instagrim-dev/roi-plugin` or `@instagrim-dev/roi`.
2. Decide whether to keep the unscoped `roi-plugin` tarball name for GitHub
   Releases while adding a scoped package name for registry publishing.
3. Remove or conditionalize `"private": true` only for the registry-publish
   lane; preserve accidental-publication protection for ordinary local work.
4. Add `publishConfig.registry = "https://npm.pkg.github.com"` for the GitHub
   Packages lane, or generate a publish-only package manifest during release.
5. Add a GitHub Actions release workflow with:
   - `permissions.contents: read`
   - `permissions.packages: write`
   - `pnpm run release:check` before publish
   - `GITHUB_TOKEN` for GitHub Packages publish.
6. Document install requirements:
   - `.npmrc` scope mapping to `https://npm.pkg.github.com`
   - authenticated install requirement
   - intended use as internal/canary distribution.
7. Keep npmjs as a separate future decision if broad public registry
   distribution becomes a goal.

## Non-goals

- Do not replace the current GitHub Release tarball lane.
- Do not require general users to configure GitHub package auth before the ROI
  public-install story intentionally changes.
- Do not publish to npmjs in the same slice as GitHub Packages unless a separate
  public-distro decision explicitly approves that lane.
