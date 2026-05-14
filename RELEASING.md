# Releasing

Publishing is manual, following the same pattern as [`slack-edge`](https://github.com/slack-edge/slack-edge). From a clean `main` checkout:

1. **Bump the version** — pick the new `X.Y.Z` and run:
   ```sh
   npm version X.Y.Z -m "version %s" --tag-version-prefix=v
   ```
   This updates `package.json` + `package-lock.json`, creates a `version X.Y.Z` commit, and tags it `vX.Y.Z`.

2. **Push the commit and tag:**
   ```sh
   git push origin main --follow-tags
   ```

3. **Publish to npm:**
   ```sh
   npm publish
   ```
   The `prepublishOnly` script runs `npm run build:clean` for you, so `dist/` is always rebuilt from the current source. Tarball contents are governed by the `files` field in `package.json` — sanity-check with `npm pack --dry-run` if anything about the file layout has changed.

4. **Create a GitHub Release** with hand-written notes summarising the changes:
   ```sh
   gh release create vX.Y.Z --title vX.Y.Z --notes "- First change
   - Second change"
   ```
   Or use `--generate-notes` to seed from merged PRs and edit before publishing.

## Prerequisites

- You have publish rights on the [`slack-cloudflare-workers`](https://www.npmjs.com/package/slack-cloudflare-workers) npm package.
- You're logged in: `npm whoami` should return your npm user.
- CI is green on `main` ([CI Build workflow](.github/workflows/build.yml)).

## Notes

- If you'd rather not pass `--tag-version-prefix=v` every time, set it once globally: `npm config set tag-version-prefix v`.
