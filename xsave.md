## intel spec chapter 13

### MANAGING STATE USING THE XSAVE FEATURE SET

XSAVE feature 扩展了 `FXSAVE`和`FXRSTOR` instruction 功能。
来支持save/restore
* x87 execution environment(x87 state)
* the registers used by the streaming SIMD extensions (SSE state)

xsave feature 由8个指令构成:
