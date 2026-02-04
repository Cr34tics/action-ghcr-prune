# Copilot Instructions for action-ghcr-prune

## Project Overview

This is a **GitHub Action** that prunes/deletes container package versions from GitHub Container Registry (ghcr.io). The action is written in **JavaScript (Node.js)** and is distributed as a compiled single-file action using `@vercel/ncc`.

### Key Purpose
- Automate cleanup of old/unused container versions from GHCR
- Support filtering by tags, age, and other criteria
- Prevent accidental deletion with safe defaults and dry-run mode

## Repository Structure

```
action-ghcr-prune/
├── .github/
│   ├── workflows/
│   │   └── ci.yml              # CI workflow with unit and integration tests
│   └── dependabot.yml          # Dependency update configuration
├── src/                        # Source code directory
│   ├── octokit.js              # GitHub API wrapper functions
│   ├── docker-api.js           # Docker Registry API client
│   ├── pruning.js              # Core pruning logic
│   ├── pruning.test.js         # Pruning unit tests
│   ├── version-filter.js       # Version filtering logic
│   └── version-filter.test.js  # Filter unit tests
├── test/
│   └── Dockerfile              # Test docker image
├── dist/                       # Compiled action output (MUST be committed)
│   ├── index.js                # Compiled single-file action
│   └── licenses.txt            # Bundled licenses
├── index.js                    # Main entry point
├── action.yml                  # GitHub Action metadata
├── package.json                # Node.js dependencies
└── README.md                   # User-facing documentation
```

## Development Workflow

### Prerequisites
- **Node.js**: v20.x (specified in action.yml and CI workflow)
- **npm**: 10.x or compatible

### Installing Dependencies

```bash
npm ci  # Use ci for clean, reproducible installs
```

**Note**: You may see deprecation warnings for `inflight` and `glob` - these are from jest dependencies and are safe to ignore.

### Running Tests

```bash
npm test  # Runs Jest unit tests
```

The test suite includes:
- **Unit tests**: Test filtering and pruning logic in isolation
- **Integration tests**: Run in CI workflow, test the action against real GHCR packages

**Important**: Integration tests in CI use a test container `vlaurin/test-action-ghcr-prune` and expect specific version IDs. These are real integration tests that verify the action works with GitHub's API.

### Building the Action

```bash
npm run build  # Compiles src to dist/index.js using @vercel/ncc
```

**CRITICAL**: The `dist/` directory MUST be committed after every code change. GitHub Actions run from the compiled `dist/index.js`, not from source files. Forgetting to build and commit will cause the action to run outdated code.

### Code Style

This project uses **Prettier** for formatting:
- Single quotes
- No semicolons
- 2-space indentation
- Trailing commas

There's no automated linting command, but follow the existing code style when making changes.

## Architecture & Code Patterns

### Functional Programming Style
The codebase heavily uses **curried functions** and **higher-order functions**:

```javascript
// Example: Curried function pattern used throughout
const deleteOrgContainerVersion =
  (octokit) => (organization, container) => (version) =>
    octokit.rest.packages.deletePackageVersionForOrg({...})
```

This pattern allows partial application and function composition.

### Key Modules

1. **octokit.js**: Thin wrappers around GitHub's REST API for package operations
   - List versions (by org, user, or authenticated user)
   - Delete versions (by org, user, or authenticated user)

2. **docker-api.js**: Docker Registry v2 API client
   - Fetches manifests for multi-platform image handling
   - Supports both OCI and Docker manifest formats

3. **version-filter.js**: Core filtering logic
   - Implements inclusion/exclusion filter precedence
   - Handles tag regex matching, age filtering, etc.

4. **pruning.js**: Orchestrates the pruning process
   - Paginates through all versions
   - Applies filters
   - Handles multi-platform images specially
   - Executes deletions with error handling

5. **index.js**: Entry point
   - Parses action inputs
   - Validates mutually exclusive inputs
   - Handles backward compatibility for deprecated inputs
   - Writes job summary

## Common Patterns & Gotchas

### 1. Mutually Exclusive Inputs
Several inputs are mutually exclusive and MUST NOT be used together:
- `organization` and `user` (only one owner type allowed)
- `prune-untagged` and `remove-multi-platform`

Always validate these in the entry point.

### 2. Deprecated Inputs
The action maintains backward compatibility for:
- `tag-regex` → now `prune-tags-regexes`
- `untagged` → now `prune-untagged`
- `older-than` → now `keep-younger-than`

Keep this compatibility when adding new features.

### 3. Multi-Platform Images
Multi-platform images have untagged child manifests (per architecture). Special handling prevents accidentally deleting these:
- When `prune-untagged` is enabled, the action scans for multi-platform parents
- Child digests are excluded from pruning
- `remove-multi-platform` explicitly targets these children

### 4. Filter Precedence
**Exclusion filters ALWAYS win over inclusion filters**:
1. Age exclusions (`keep-younger-than`)
2. Tag exclusions (`keep-tags`, `keep-tags-regexes`)
3. Inclusion criteria (`prune-untagged`, `prune-tags-regexes`)
4. Keep-last sorting

### 5. Dry-Run Pattern
Dry-run is implemented by substituting the delete function:
```javascript
const pruneVersion = dryRun
  ? dryRunDelete  // Just logs
  : deleteOrgContainerVersion(octokit)(organization, container)
```

### 6. Pagination
All list operations paginate with `PAGE_SIZE = 100`. Always handle pagination in loops:
```javascript
do {
  const { data: versions } = await listVersions(PAGE_SIZE, page)
  lastPageSize = versions.length
  allVersions = [...allVersions, ...versions]
  page++
} while (lastPageSize >= PAGE_SIZE)
```

## Testing Guidelines

### Unit Tests
- Located in `src/*.test.js` files
- Use Jest as test runner
- Mock external dependencies (Octokit, HTTP clients)
- Test both positive and negative cases

### Integration Tests
- Defined in `.github/workflows/ci.yml`
- Test against real GHCR package `vlaurin/test-action-ghcr-prune`
- Verify specific version IDs are returned
- Use dry-run mode to avoid actual deletions
- Test both current and deprecated input names

### Adding Tests
When modifying filtering logic:
1. Add unit tests in `version-filter.test.js` or `pruning.test.js`
2. Consider if integration tests need updating
3. Ensure both deprecated and current input names work

## CI/CD

### CI Workflow (`.github/workflows/ci.yml`)

1. **Runs on**: Push to main, PRs, manual dispatch
2. **Steps**:
   - Checkout code
   - Setup Node.js 20 with npm cache
   - Install dependencies (`npm ci`)
   - Run unit tests (`npm test -- --coverage`)
   - Build action (`npm run build`)
   - Clear node_modules (to test action runs without dev dependencies)
   - Run integration tests (multiple scenarios testing the built action)

### Integration Test Pattern
The CI workflow tests the action by using it on itself (`. /`):
```yaml
- name: Should prune untagged versions
  uses: ./ # Run the action from current checkout
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    user: vlaurin
    container: test-action-ghcr-prune
    dry-run: true
    prune-untagged: true
```

Then validates the outputs match expected values.

## Action Inputs & Outputs

### Required Inputs
- `token`: PAT with `packages:read` and `packages:delete` scopes
- `container`: Container package name

### Optional Inputs
- **Owner**: `organization` OR `user` (mutually exclusive)
- **Exclusion Filters**: `keep-last`, `keep-tags`, `keep-tags-regexes`, `keep-younger-than`
- **Inclusion Filters**: `prune-untagged`, `prune-tags-regexes`
- **Special**: `dry-run`, `remove-multi-platform`

### Outputs
- `count`: Number of versions pruned
- `prunedVersionIds`: Array of pruned version IDs
- `dryRun`: Boolean indicating if it was a dry-run

## Common Issues & Workarounds

### Issue 1: "Package not found" errors during actual deletion

**Cause**: The token's user doesn't have admin permissions on the package or organization.

**Workaround**: 
- Verify the token owner is an admin on both the org and package
- Dry-runs will work but actual deletions will fail

### Issue 2: npm vulnerabilities on install

**Status**: Known issue with transitive dependencies from jest.

**Impact**: Low - these are dev dependencies, not shipped in the action.

**Workaround**: Currently acceptable to ignore. Could upgrade jest in the future.

### Issue 3: Forgetting to rebuild after code changes

**Symptom**: Code changes don't take effect in testing.

**Cause**: The action runs from `dist/index.js`, not source files.

**Solution**: Always run `npm run build` after code changes and commit `dist/`.

### Issue 4: Integration tests fail with "wrong version IDs"

**Cause**: The test container versions changed on GHCR.

**Solution**: Integration tests expect specific version IDs. If the test container is updated, tests must be updated to match new IDs.

## Making Changes

### Modifying Filter Logic
1. Update `src/version-filter.js`
2. Add/update tests in `src/version-filter.test.js`
3. Run `npm test` to verify
4. Run `npm run build` to compile
5. Commit both source and `dist/`

### Adding New Inputs
1. Add to `action.yml` with description and default
2. Update `index.js` to read the input
3. Update README.md with documentation
4. Add tests (unit and potentially integration)
5. Consider backward compatibility

### Modifying Octokit/API Calls
1. Update relevant function in `src/octokit.js` or `src/docker-api.js`
2. Add unit tests with mocked responses
3. Test with integration tests if possible

## Best Practices

1. **Always test with dry-run first**: The action is destructive, so always test configuration changes with `dry-run: true`

2. **Maintain backward compatibility**: This action is used in many workflows, breaking changes should be avoided

3. **Use semantic versioning**: Users reference this action by version (e.g., `v0.6.0`), so version bumps should be semantic

4. **Document breaking changes**: If a breaking change is unavoidable, document it clearly and provide migration guide

5. **Keep compiled dist/ in sync**: The `dist/` directory is not in `.gitignore` and MUST be committed

6. **Preserve currying patterns**: The codebase uses curried functions extensively for composition - maintain this style

## Security Considerations

- Never log tokens or sensitive data
- The action requires powerful permissions (`packages:delete`) - ensure safe defaults
- Default behavior is to prune nothing (`prune-untagged: false`, no tag regexes)
- Always encourage users to test with dry-run

## Quick Reference Commands

```bash
# Install dependencies
npm ci

# Run tests
npm test

# Build action
npm run build

# Run everything (like CI)
npm ci && npm test && npm run build
```

## Notes for Coding Agents

- This is a **GitHub Action**, so the compiled `dist/index.js` is what actually runs
- The test suite is comprehensive but integration tests depend on external state (GHCR)
- The codebase is small (~1000 LOC) but uses advanced JavaScript patterns
- Backward compatibility is important - this is used in production workflows
- Always validate inputs early to provide clear error messages
- The README is the primary user documentation - keep it in sync with code changes
