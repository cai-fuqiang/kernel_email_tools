## intel spec chapter 13

### MANAGING STATE USING THE XSAVE FEATURE SET

XSAVE feature 扩展了 `FXSAVE`和`FXRSTOR` instruction 功能。
来支持save/restore
* x87 execution environment(x87 state)
* the registers used by the streaming SIMD extensions (SSE state)

xsave feature 由8个指令构成:
* `XGETBV, XSETBV` : read/write XCR0, 其控制了 XSAVE feature set 的 行为
* `XSAVE, XSAVEOPT, XSAVEC, XSAVES`: save process state to memory
* `XRSTOR, XRSTORS`: load process state from memory

运行这些指令的特权级:

* `XSETBV, XSAVES, XRSTORS`: CPL=0
* `XGETBV, XSAVE, XSAVEOPT, XSAVEC, XRSTORS`:  execute any privilege level

xsave feature 要管理的内容（比如 FPU 寄存器、SSE、AVX、MPX的上下文等）
划分为多个“状态组件”。每一类寄存器或者扩展状态就是一个“组件”（component）。


