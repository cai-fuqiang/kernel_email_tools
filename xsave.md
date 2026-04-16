## intel spec chapter 13

**_MANAGING STATE USING THE XSAVE FEATURE SET_**

***

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
划分为多个`state component`。每一类寄存器或者扩展状态就是一个“组件”（component）。
 
而管理这些组件基于`state-component bitmaps`, 这个bitmap格式类似于`XCR0`/`IA32_XSS` MSR.
每一个bit表示一个`state component`.

13.1 描述了这些`state component` 具体有哪些并详细描述了bitmap的细节.

***

13.2 描述了 processo 如何枚举 XSAVE feature set(不止一个feature...) 和 **XSAVE-enabled
features**(这些feature 依赖 XSAVE-feature, 也就是说如果使能这些`XSAVE-enabled` feature,
需要使能`XSAVE feature`)

***

13.3 描述了软件如何 enable XSAVE feature set 和 XSAVE-enabled feature.

***

XSAVE feature set 允许 从 `XSAVE area`(a memory region) 中 save/load process
state. 13.4 展示了 `XSAVE area` 细节。

***

每一个`XSAVE-managed state component` 对应着 `XSAVE area` 中的一部分。13.5 描述了
每一个`XSAVE-managed state component`

***

### XSAVE-SUPPORTED FEATURES AND STATE-COMPONENT BITMAPS
