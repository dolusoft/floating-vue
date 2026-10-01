# Releasing the Dolusoft fork

The `dolusoft/floating-vue` fork does not publish to npm. Its releases are tarballs attached to
GitHub Releases, built locally from the `main` branch. The upstream `release` script (`sheep`)
and the tag-triggered `Create release` workflow are not part of this flow.

## Version scheme

`<upstream version>-[<prerelease>.]dolusoft.<n>`, for example `5.2.2-dolusoft.1`.

- `<upstream version>` is the upstream version the fork is based on (currently `5.2.2`).
- `<n>` starts at 1 and increases with every fork release; it never resets while the upstream base
  stays the same.
- A prerelease suffix is required, so a fork build sorts below the next upstream stable release.

The npm build `@dolusoft/floating-vue@5.3.0` predates this scheme; it was not an upstream version.

The tag is `v<version>` and the asset is `dolusoft-floating-vue-<version>.tgz` (the `pnpm pack`
name of `@dolusoft/floating-vue`).

## Steps

1. Bump `version` in `packages/floating-vue/package.json` on `main` and commit.
2. Run `pnpm release:dolusoft --dry-run`. It refuses to run on another branch, with a dirty working
   tree or when the tag already exists on `origin`; then it runs lint, the build and the
   `test:node` suite, packs the tarball into `.release/`, checks that the consumer files are in it
   and that the packed manifest has the right version and no `workspace:` or `catalog:` ranges.
   It only warns if `HEAD` is not pushed yet.
3. Push `main`.
4. Run `pnpm release:dolusoft`. It repeats the checks, refuses to continue unless `HEAD` equals
   `origin/main`, then creates an annotated tag, pushes it and creates a prerelease with the
   tarball as its asset.

If the dry run fails, fix it in a new commit and start again from step 2.

The peeky unit runner (`test:unit`) does not finish on Windows, so the release runs only
`test:node` (node:test + happy-dom against the built bundle).

## If the release step fails after the tag is pushed

Do not delete or move the tag. Either create the Release for that tag by hand from the tarball
the run left in `.release/`, which was built from the tagged commit:

```bash
gh release create v<version> .release/dolusoft-floating-vue-<version>.tgz \
  --repo dolusoft/floating-vue --verify-tag --prerelease \
  --title "floating-vue <version> (Dolusoft fork)" \
  --notes "Built from <sha> on main. Consume via the asset URL; never overwrite."
```

or, if `.release/` no longer matches the tagged commit, leave the tag as it is and release the
next `<n>`.

## Immutability

A published tag is never moved and a published asset is never replaced or deleted. A broken
release is fixed by releasing the next `<n>`.

## Consuming a release

Reference the asset URL of a specific version; there is no `latest` URL:

```json
"floating-vue": "https://github.com/dolusoft/floating-vue/releases/download/v<version>/dolusoft-floating-vue-<version>.tgz"
```

Update the manifest and the lockfile in the same commit. The repository is private: an
unauthenticated download of the asset fails, so a consumer's CI or Docker build cannot fetch it
until the repository is public or the build is given a token.

## Fork deviations

Keep these when merging upstream; do not resolve a conflict by taking the upstream side.

- **Vue 3.5 build and `dispose()` retainer fix** (see the fork's first commit).
- **Coalesced re-render of the shared directive app** (`src/directives/v-tooltip.ts`). All
  `v-tooltip` directives render in one shared app (`VTooltipDirectiveApp`). Upstream kept the
  directive list and each directive's options in reactive state read by that app's render, so
  every directive created, updated or destroyed re-queued the app's render job right after the
  job that caused it. With a few hundred directives mounted in separate component jobs in one
  tick (frontendx dashboard cells entering edit mode) the flush exceeded Vue's recursive update
  limit and Vue dropped the remaining jobs. The list is now plain, the per-directive `options`
  and `shown` refs are untracked `customRef`s that schedule an update, and the render tracks a
  single revision bumped at most once per flush in a post-flush callback. `el.$_popper.options`
  and `show()`/`hide()` keep their API. Guarded by `tests/node/directive-batch.test.mjs`.
- **Content change on a tooltip that is unmounted meanwhile** (`src/components/TooltipDirective.vue`).
  The `finalContent` watcher waits a tick before repositioning the popper. Upstream then called
  `this.$refs.popper.onResize()` unconditionally; if the tooltip was unmounted during that tick
  (frontendx closes the dropdown holding the target right after a UI language switch changed the
  content) `$refs.popper` is `null` and the watcher threw `Cannot read properties of null (reading
  'onResize')`. The call is skipped when the popper is gone. Guarded by
  `tests/node/content-change.test.mjs`, which also checks that an open tooltip is still
  repositioned.
