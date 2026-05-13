# Releasing

Publishing is manual. From a clean `main` checkout:

1. **Bump the version** — pick the new `X.Y.Z` and run:
   ```sh
   npm version X.Y.Z -m "version %s"
   ```
   This updates `package.json` + `package-lock.json`, creates a `version X.Y.Z` commit, and tags it `X.Y.Z` (no `v` prefix, matching prior tags).

2. **Push the commit and tag:**
   ```sh
   git push origin main --follow-tags
   ```

3. **Publish to npm:**
   ```sh
   npm publish
   ```
   The `prepublishOnly` script runs `npm run build:clean` for you, so `dist/` is always rebuilt from the current source. Tarball contents are governed by the `files` field in `package.json` — sanity-check with `npm pack --dry-run` if anything about the file layout has changed.

## Prerequisites

- You have publish rights on the [`slack-cloudflare-workers`](https://www.npmjs.com/package/slack-cloudflare-workers) npm package.
- You're logged in: `npm whoami` should return your npm user.
- CI is green on `main` ([CI Build workflow](.github/workflows/build.yml)).
