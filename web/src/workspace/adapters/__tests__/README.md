# Workspace Adapter Tests

这里的 `.test.ts` 文件是纯 TypeScript 断言文件，当前项目尚未引入 vitest/jest，
因此它们**不会**被 `npm run test` 或 CI 执行；仅作为：

1. 用例沉淀：记录每个 adapter 在边界条件下的预期输出
2. 手动校验：改动 adapter 时可以用 `npx tsx <file>` 临时跑一下

后续引入 vitest 后，这些文件可直接接入（函数签名和 `assert.deepEqual` 风格兼容）。
详见 PLAN-31005 的 "Test Plan" 小节。