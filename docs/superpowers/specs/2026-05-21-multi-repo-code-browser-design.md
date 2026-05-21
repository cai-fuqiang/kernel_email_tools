# Multi-Repository Code Browser Design

## Goal

Add a configurable source-code browser that can serve multiple Git repositories. The first non-kernel repository is QEMU, and the design must allow future repositories such as OVS to be added through configuration.

## Scope

In scope:
- Configure repositories with stable ids, display names, local Git paths, optional Bootlin Elixir bases, and default versions.
- Preserve the existing Linux kernel browser URL, `/kernel-code`.
- Add a generic browser URL, `/code/:repoId`, for repositories such as QEMU.
- Add generic backend APIs under `/api/code/{repo_id}` for versions, tree, file, path resolution, and symbol resolution.
- Keep kernel-only history, blame, line-history, commit patch, and annotation behavior unchanged.

Out of scope:
- QEMU annotations.
- QEMU blame, line history, and commit patch browsing.
- Database schema changes.
- Manual PDF, knowledge, tag, and email search behavior.

## Configuration

The existing `kernel_source` block remains supported for backward compatibility. A new `code_repositories` block declares additional repositories:

```yaml
code_repositories:
  qemu:
    name: QEMU
    repo_path: /home/wang/workspace/qemu/.git
    default_version: master
    elixir_base: https://elixir.bootlin.com/qemu
```

The server also registers the existing kernel source as repository id `linux`. This keeps old `/api/kernel/...` endpoints working while allowing `/api/code/linux/...` to use the same registry.

## Backend Architecture

`src/api/state.py` owns a new `_code_repositories` dictionary keyed by repository id. Each entry contains display metadata and a source object. The source object is the existing `GitLocalSource` wrapped in `FallbackKernelSource` when an Elixir base is configured.

`src/kernel_source/elixir.py` becomes configurable with `project` or `base_url`, replacing hard-coded Linux URL matching with project-aware parsing. Linux behavior remains the default.

`src/api/routers/kernel.py` keeps all existing kernel routes. The same module adds generic code routes because the response shapes and helper functions are intentionally shared with the kernel browser. Generic routes resolve `repo_id` through the registry and reject unknown ids with 404.

## Frontend Architecture

`KernelCodePage` becomes repository-aware through an optional `repoId` prop. `/kernel-code` renders it with `linux` to preserve existing links. `/code/:repoId` renders the same component with the route repository id.

The page switches copy from "Kernel" to the repository display name where practical, but does not redesign the layout. Kernel-only features remain enabled only for `linux`: annotations, history inspector, userscript, and kernel-specific preview links. Generic repositories keep the tree, file view, line jump, Bootlin source link, and symbol popover.

`web/src/utils/externalLinks.ts` adds generic code path and Bootlin URL helpers while retaining the existing kernel helpers as wrappers.

## Data Flow

1. Frontend loads repository metadata from `/api/code/repositories`.
2. For `/kernel-code`, the active repo id is `linux`; for `/code/qemu`, it is `qemu`.
3. Versions, tree, file, resolve, and symbol requests call `/api/code/{repo_id}/...`.
4. Kernel-only panels call the existing `/api/kernel/...` endpoints only when repo id is `linux`.
5. External links use repository metadata `elixir_base`; if absent, they fall back to local-only behavior.

## Errors

- Unknown repository id returns 404.
- Configured local repo path missing logs a warning and does not register that repository.
- A repository without Elixir fallback still supports local versions, tree, and file APIs.
- Symbol resolution returns an empty candidate list with a fallback reason when no Elixir base is configured.

## Testing

Backend tests should cover repository registry initialization, generic file/tree routing, and QEMU Bootlin URL construction without requiring network access.

Frontend tests should cover route selection, generic API URL construction, and hiding kernel-only panels for non-linux repositories.

## Acceptance

- Existing `/app/kernel-code?v=...&path=...` keeps working.
- `/app/code/qemu?v=master&path=README.rst` can open a configured QEMU repository.
- QEMU source links point at `https://elixir.bootlin.com/qemu/...`.
- Adding an OVS repository requires configuration plus restart, not new route code.
