# Releasing

A version of `rampa-cli` reaches npm and GitHub when its tag is pushed. [`.github/workflows/release.yml`](.github/workflows/release.yml) then does the rest, in three jobs:

1. **build**, with a read-only token: checks that the tag matches `package.json`, takes the version's notes from `CHANGELOG.md`, runs what CI runs (`pnpm typecheck`, `pnpm test`, `pnpm build`), packs the tarball with `pnpm pack`, and installs that tarball in an empty folder to check that `rampa --version` prints the version.
2. **publish**, the only job that can get an OIDC token: `npm publish rampa-cli-<version>.tgz --provenance --access public`. npm trusts the workflow through [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored in GitHub, and it signs a [provenance statement](https://docs.npmjs.com/generating-provenance-statements) that links the version to the commit and the run that built it.
3. **github-release**: creates the GitHub release from the tag, with the `CHANGELOG.md` section as its notes and the tarball attached.

## Once: trusted publishing on npmjs.com

Do this shortly before the first release from the workflow: a new trusted publisher that has not published within 2 days expires, and then has to be deleted and made again.

1. Sign in to [npmjs.com](https://www.npmjs.com) as `guilhermebs` and open the package's **Settings** tab ([npmjs.com/package/rampa-cli/access](https://www.npmjs.com/package/rampa-cli/access)).
2. In **Trusted Publisher**, under **Select your publisher**, choose **GitHub Actions**.
3. Fill in the fields exactly; they are case-sensitive, and npm does not check them when you save:

   | Field | Value |
   | --- | --- |
   | Organization or user | `guilhermebsantiago` |
   | Repository | `rampa-cli` |
   | Workflow filename | `release.yml` (the file name only, not its path) |
   | Environment name | `npm` |
   | Allowed actions | tick **npm publish**; leave **npm dist-tag** off |

   Ticking **npm publish** matters: a trusted publisher created after 3 September 2026 allows only `npm stage publish` unless you tick it, and npm rejects the workflow's `npm publish`. To have every release wait for your approval instead, see [Staged publishing](#staged-publishing-instead).
4. Save.

After the first release from the workflow has worked:

5. In **Settings**, under **Publishing access**, choose **Require two-factor authentication and disallow tokens** and save. The workflow keeps publishing, since trusted publishing is not a token in this sense; a publish from your own machine still works with 2FA.
6. Delete any npm access tokens that could publish and are no longer needed (your avatar, **Access Tokens**).

On GitHub, the `npm` environment appears with the first run. To limit who can publish before that, create it yourself in the repository's **Settings → Environments → New environment**, named `npm`, and in it:

- under **Deployment branches and tags**, choose **Selected branches and tags** and add the tag rule `v*`, so only a version tag can publish;
- optionally, under **Required reviewers**, add yourself: every publish then waits for your approval in the run.

## A release

1. On `main`, with CI green, pick the version, such as `0.2.0`. A version with a prerelease part, such as `0.2.0-beta.1`, is published under the npm tag `next` instead of `latest` and marked as a prerelease on GitHub.
2. Write the version where it appears. `test/release.test.ts` fails until all of these agree:
   - `package.json`: `npm version 0.2.0 --no-git-tag-version` changes only that field.
   - `CITATION.cff`: `version: 0.2.0`.
   - The pinned action, `guilhermebsantiago/rampa-cli@v0.2.0`, in `README.md`, `docs/github-action.md` and `examples/github-workflow.yml`. (`rampa init` reads the version from `package.json` by itself.)
   - `CHANGELOG.md`: move the notes under **Unreleased** to a new `## [0.2.0] - <date>` section, and leave **Unreleased** empty above it. That section becomes the release notes; without it, the workflow stops before it publishes.
3. Check and commit, then push `main` and wait for CI:

   ```sh
   pnpm typecheck && pnpm test && pnpm build
   git commit -am "Release 0.2.0"
   git push origin main
   ```

4. Tag that commit and push the tag, which starts the release:

   ```sh
   git tag -a v0.2.0 -m "rampa-cli 0.2.0"
   git push origin v0.2.0
   ```

5. Follow it with `gh run watch`, or under **Actions → release**. The build job takes about as long as CI (around 13 minutes on GitHub's runners).

When a job fails:

- **build**: nothing was published. For a flaky test, use **Re-run failed jobs**. To change the code, fix it on `main`, delete the tag (`git push origin :refs/tags/v0.2.0` and `git tag -d v0.2.0`), and tag the new commit.
- **publish**, with `ENEEDAUTH` or a 404: npm did not accept the workflow. Check the four fields of the trusted publisher and that **npm publish** is allowed; the job's `npm verbose oidc` lines say what the token exchange answered. Fix it on npmjs.com, then **Re-run failed jobs**: the tag can stay.
- **github-release**, after the publish worked: **Re-run failed jobs**, not all jobs, since npm accepts each version only once.

A published version cannot be replaced. If one is broken, deprecate it (`npm deprecate rampa-cli@0.2.0 "Broken: use 0.2.1"`) and release the next patch.

## Staged publishing instead

npm can hold a release until a maintainer approves it with 2FA ([staged publishing](https://docs.npmjs.com/staged-publishing)). To release that way:

1. In the trusted publisher, leave **npm publish** unticked; `npm stage publish` is always allowed.
2. In the publish job of `release.yml`, change `npm publish` to `npm stage publish`, with the same arguments.
3. After a run, approve the version in the package's **Staged Packages** tab on npmjs.com, or with `npm stage approve <stage-id>` (the job log shows the id). Approving needs your 2FA and cannot run in the workflow, since OIDC tokens cannot approve.

The GitHub release is still created when the run ends, so it exists before you approve the version on npm.

## Check the provenance

0.1.0 was published by hand, so it has no provenance. Each version the workflow publishes does:

- **On npmjs.com**: on [the package's page](https://www.npmjs.com/package/rampa-cli), in the **Version** field to the right of the README, a green check mark shows that the version has provenance. Click it, then **View more details**: the build environment, the workflow run, the source commit, the workflow file (`.github/workflows/release.yml`) and the entry in Sigstore's public transparency log.
- **From the registry**: `npm view rampa-cli@0.2.0 dist.attestations` prints the attestations' address and `predicateType: 'https://slsa.dev/provenance/v1'`; a version without provenance prints nothing.
- **In a project that installed it**: `npm audit signatures` counts `rampa-cli` among the packages with verified attestations.
