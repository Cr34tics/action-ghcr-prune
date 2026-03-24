# action-ghcr-prune

GitHub Action to prune/delete container versions from GitHub Container Registry (ghcr.io).

## 🎉 Version 1.0 - TypeScript Migration

Version 1.0 represents a complete modernization of this action with:

- ✨ **TypeScript** - Full type safety with strict mode enabled
- 🧪 **Vitest** - Faster test execution with better TypeScript support
- 📦 **Yarn** - Improved dependency management
- 🔍 **ESLint v9** - Strict linting rules for code quality
- 🚀 **Latest @actions packages** - Using @actions/core v3 and @actions/github v9
- 🔄 **Unified workflow** - Single test workflow for CI/CD

### ⚠️ Breaking Changes in v1.0

The following deprecated inputs have been **removed**. Update your workflows before upgrading:

| Removed Input | Use Instead          |
| ------------- | -------------------- |
| `older-than`  | `keep-younger-than`  |
| `untagged`    | `prune-untagged`     |
| `tag-regex`   | `prune-tags-regexes` |

**Migration Example:**

```yml
# ❌ Old (v0.x)
- uses: vlaurin/action-ghcr-prune@v0.6.0
  with:
    untagged: true
    older-than: 7
    tag-regex: ^pr-

# ✅ New (v1.0)
- uses: Cr34tics/action-ghcr-prune@v1
  with:
    prune-untagged: true
    keep-younger-than: 7
    prune-tags-regexes: ^pr-
```

## ⚠️ Word of caution

By default, both `prune-untagged` and `prune-tags-regexes` inputs are disabled and as result no versions will be matched for pruning. Either or both inputs must be explicitly configured for versions to be pruned. This behaviour helps to avoid pruning versions by mistake when first configuring this action.

As this action is destructive, it's recommended to test any changes to the configuration of the action with a dry-run to ensure the expected versions are matched for pruning. For more details about dry-runs, see the [dry-run input](#dry-run).

This is especially true when the [`prune-tags-regexes` input](#prune-tags-regexes) is used as regular expressions can easily match all versions of a container and result in complete deletion of all available versions.

## Quick start

Pruning all untagged versions older than 7 days, except the 2 most recent:

```yml
steps:
  - name: Prune
    uses: Cr34tics/action-ghcr-prune@v1
    with:
      token: ${{ secrets.YOUR_TOKEN }}
      organization: your-org
      container: your-container
      dry-run: true # Dry-run first, then change to `false`
      keep-younger-than: 7 # days
      keep-last: 2
      prune-untagged: true
```

For more pruning strategies, [see filters](#mag-filters).

## Permissions

This action uses the Github Rest API [deletePackageVersionForOrg()](https://octokit.github.io/rest.js/v18#packages-delete-package-version-for-org) resource which states:

> To use this endpoint, you must have admin permissions in the organization and authenticate using an access token with the `packages:read` and `packages:delete` scopes. In addition:
> [...]
> If `package_type` is container, you must also have admin permissions to the container you want to delete.

As a result, for this action to work, the token must be associated to a user who has admin permissions for both the organization and the package. If this is not the case, then dry-runs will work as expected but actual runs will fail with a `Package not found` error when attempting to delete versions.

## Inputs

### token

**Required** Secret access token with scopes `packages:read` and `packages:delete` and write permissions on the targeted container. See [Creating a personal access token
](https://docs.github.com/en/github/authenticating-to-github/keeping-your-account-and-data-secure/creating-a-personal-access-token) for more details about GitHub access tokens.

### organization

Name of the organization owning the container package.

:warning: This input is mutually exclusive with input `user`.
Only one of the 2 can be used at any time.
If neither are provided, then the packages of the authenticated user (cf. `token`) are considered.

### user

Name of the user owning the container package.

:warning: This input is mutually exclusive with input `organization`.
Only one of the 2 can be used at any time.
If neither are provided, then the packages of the authenticated user (cf. `token`) are considered.

### container

**Required** Name of the container package for which versions should be pruned.

### dry-run

**Optional** Boolean controlling whether to execute the action as a dry-run. When `true` the action will print out details of the version that will be pruned without actually deleting them. Defaults to `false`.

As this action is destructive, it's recommended to test any changes to the configuration of the action with a dry-run to ensure the expected versions are matched for pruning.

### remove-multi-platform

**Optional** Boolean controlling whether the child digests of multi-platform images should
be pruned (`true`) or not (`false`). Defaults to `false`.

Turning this on will force the removal of the untagged platform variants
attached to multi-platform images. Due to variants being untagged you cannot
use this option with `prune-untagged`. You also must specify either `user` or
`organization`.

### :mag: Filters

This action supports 2 types of filters:

- Exclusion filters, prefixed with `keep-`, exclude versions from pruning, preventing them from being deleted.
- Inclusion filters, prefixed with `prune-`, select the versions to prune.

**Exclusion filters always take precedence over inclusion filters.**
This means that if a version of a container is matched by both an exclusion and an inclusion filter, the exclusion will take priority and the version will not be pruned.

Versions that are not matched by any filter are preserved.

#### keep-last

**Optional** Count of most recent, matching containers to exclude from pruning. Defaults to `0` which means that all matching containers are pruned.

#### keep-tags

**Optional** List of tags to exclude from pruning, one per line.
Any version with at least one matching tag will be excluded.
Matching is exact and case-sensitive.

#### keep-tags-regexes

**Optional** List of regular expressions for tags to exclude from pruning, one per line.
Each expression will be evaluated against all tags of a version. Any version with at least one tag matching the expression will be excluded from pruning.

For example, pruning all versions with tags starting with either `pr-` or `test-`, except the ones ending with numbers 42 or 1337:

```yml
steps:
  - name: Prune
    uses: Cr34tics/action-ghcr-prune@v1
    with:
      token: ${{ secrets.YOUR_TOKEN }}
      organization: your-org
      container: your-container
      dry-run: true # Dry-run first, then change to `false`
      keep-tags-regexes: |
        42$
        1337$
      prune-tags-regexes: |
        ^pr-
        ^test-
```

#### keep-younger-than

**Optional** Minimum age in days a version must have to qualify for pruning. All versions below that age at time of execution are excluded from pruning. Defaults to `0` which means no versions will be excluded from pruning.

#### prune-tags-regexes

**Optional** List of regular expressions for tags to prune, one per line.
Each expression will be evaluated against all tags of a version.
Any version with at least one tag matching the expression will be pruned.
Disabled by default (ie. no versions pruned based on tags).

:warning: **Please note:** Extra care should be taken when using `prune-tags-regexes`, please make sure you've read the [Word of caution](#%EF%B8%8F-word-of-caution)

For example, pruning all versions with tags starting with either `pr-` or `test-`:

```yml
steps:
  - name: Prune
    uses: Cr34tics/action-ghcr-prune@v1
    with:
      token: ${{ secrets.YOUR_TOKEN }}
      organization: your-org
      container: your-container
      dry-run: true # Dry-run first, then change to `false`
      prune-tags-regexes: |
        ^pr-
        ^test-
```

#### prune-untagged

**Optional** Boolean controlling whether untagged versions should be pruned (`true`) or not (`false`). Defaults to `false`. This action will not remove any untagged versions that are child digests of multi-platform images.

### ghcr-max-retries

**Optional** Maximum number of retries for transient 404 errors from the GHCR Docker API. Defaults to `5`.

When a manifest fetch returns a 404, the action will retry up to this many times using exponential backoff (1s, 2s, 4s, 8s, 16s, … capped at 30s per attempt). With the default of 5 retries, the worst-case additional wait is approximately 31 seconds per manifest. Set to `0` to disable retries entirely.

## Outputs

### count

The count of container versions which were successfully pruned by the action.

### prunedVersionIds

An array containing all the version IDs successfully pruned as part of the run.

### dryRun

Boolean flag indicating whether the execution was a dry-run, as per input `dry-run`. This output can be used to determine if other outputs relates to a dry-run or actual pruning of versions.

## Development

This action is written in TypeScript and compiled into a single JS file using [@vercel/ncc](https://github.com/vercel/ncc). The compiled `dist/` folder must be checked in with the code.

### Prerequisites

- Node.js 20+
- Yarn 1.22+

### Setup

```bash
yarn install --frozen-lockfile
```

### Available Scripts

```bash
yarn build        # Compile TypeScript to dist/index.js
yarn test         # Run unit tests with Vitest
yarn test:watch   # Run tests in watch mode
yarn test:ui      # Open Vitest UI
yarn lint         # Run ESLint
yarn lint:fix     # Run ESLint with auto-fix
yarn type-check   # Run TypeScript type checking
yarn fmt          # Format code with Prettier
yarn fmt:check    # Check code formatting
```

### Making Changes

1. Make your changes to the TypeScript source files in `src/`
2. Add or update tests as needed
3. Run `yarn lint` and `yarn type-check` to ensure code quality
4. Run `yarn test` to ensure all tests pass
5. Run `yarn build` to compile the action
6. Commit both source files and the compiled `dist/` folder

The `dist/` folder must be committed because GitHub Actions run the compiled code, not the TypeScript source.

## License

The scripts and documentation in this project are released under the [MIT License](LICENSE).
