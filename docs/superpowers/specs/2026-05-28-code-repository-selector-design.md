# Code Repository Selector Design

## Goal

Unify Linux kernel code and QEMU code into one code browsing surface, with a repository selector in the page header.

## Chosen Approach

Use a repository dropdown in `KernelCodePage` instead of separate sidebar entries or in-page tabs. The dropdown is populated from the existing repository metadata returned by `getCodeRepositories()`.

The global sidebar should expose one `Code` entry. Existing deep links remain valid:

- `/app/kernel-code` opens the Linux repository.
- `/app/code/:repoId` opens the requested repository, such as QEMU.

## Repository State

Each repository keeps its own last viewed location:

- version
- path
- line
- annotation, when present in the URL

Switching repositories restores that repository's previous location. If the repository has no saved location, the code browser uses the repository default version and root path.

Persist this in frontend state and browser storage using a repo-scoped key such as `code-browser:last-location:<repoId>`.

## Jump And Link Behavior

All code navigation must be repository-aware. Any path that opens a source location, resolves a symbol, opens a preview, or builds a drag/deep-link payload must preserve the active `repoId`.

Linux can keep compatibility links to `/app/kernel-code`, but non-Linux repositories must use `/app/code/:repoId`.

Code lookup and jump targets must use repo-specific APIs and helpers:

- file/tree/version/symbol requests include the active `repoId`
- source links use repository metadata such as `elixir_base` when available
- annotation preview/open actions should not hard-code Linux-only paths
- drag Markdown links should point to the active repository

If implementation needs changes outside the approved brief, add the file to the Feature Brief before editing it.

## UI Layout

The page header starts with a code title and repository selector, followed by the existing version selector, "show all versions" checkbox, path input, and actions.

The dropdown should use repository display names. It should remain compact on desktop and stack cleanly on narrow screens without covering the version/path controls.

## Error Handling

If repository metadata fails to load, keep the current error toast behavior.

If a selected repository disappears from the metadata response, show the backend error or fall back to the Linux repository only when the route is the legacy `/kernel-code` path.

If a saved repo location fails to load, stay within that repository and show its root/default state instead of silently switching repositories.

## Testing

Add focused frontend coverage for:

- rendering one global Code nav entry instead of separate Kernel/QEMU entries
- repository dropdown options coming from repository metadata
- switching repositories navigates to the repo-specific route
- switching back restores the previous per-repo location
- repo-aware links and jump targets use `/code/:repoId` for QEMU and `/kernel-code` for Linux compatibility

Run the existing frontend test/build path and perform rendered QA on the code browser at `http://aliyun.cloud.vm:8080` when available.
