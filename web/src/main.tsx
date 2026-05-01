import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { getSystemConfig } from './api/client'
import { setExternalLinksConfig } from './utils/externalLinks'

// PLAN-30002: 在启动时获取后端运行时配置（external_links 镜像地址）。
// 失败时静默降级到默认 base URL，不阻塞应用渲染。
getSystemConfig()
  .then((cfg) => {
    if (cfg?.external_links) {
      setExternalLinksConfig({
        elixir_base: cfg.external_links.elixir_base || undefined,
        git_base: cfg.external_links.git_base || undefined,
        lore_base: cfg.external_links.lore_base || undefined,
      })
    }
  })
  .catch(() => { /* ignore — fallback to defaults */ })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)