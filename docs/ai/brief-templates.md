# AI Brief Templates

Use these templates to keep requests small and scoped.

## Feature Brief

```md
## Feature Brief
目标: [one sentence]
影响模块:
  - backend: [exact paths or "无"]
  - frontend: [exact paths or "无"]
补充路径:
  - [docs / AGENTS / local skill paths if needed]
不影响: [explicit exclusions]
验收: [what must be true when done]
```

## Bug Brief

```md
## Bug Brief
问题: [one sentence]
症状:
  - [visible failure]
影响模块:
  - [exact paths]
不影响: [explicit exclusions]
验收: [bug no longer reproduces]
```

## Review Brief

```md
## Review Brief
目标: [review purpose]
范围:
  - [exact paths]
重点:
  - [bugs / regressions / tests / security]
不需要: [what to skip]
```

## Refactor Brief

```md
## Refactor Brief
目标: [structure-only goal]
范围:
  - [exact paths]
保持不变:
  - [behavior / API / schema]
验收: [same behavior, cleaner structure, tests still pass]
```
