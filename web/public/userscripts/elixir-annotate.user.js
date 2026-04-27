// ==UserScript==
// @name         Kernel KB — elixir 注解
// @namespace    kernel-email-tools
// @version      0.1.0
// @description  在 elixir.bootlin.com 上为内核源码行添加注解和标签
// @author       Kernel KB
// @match        https://elixir.bootlin.com/linux/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  // ---------- config ----------
  // __API_BASE__ and __SESSION_COOKIE__ are replaced by the web app's "Copy Script" button
  const API_BASE = GM_getValue('kb_api_base', '__API_BASE__');
  const SESSION_COOKIE = GM_getValue('kb_session', '__SESSION_COOKIE__');
  const PANEL_ID = 'kb-annotate-panel';
  const DOT_CLASS = 'kb-line-dot';

  // Persist pre-filled config on first run
  if (API_BASE && API_BASE !== '__API_BASE__' && !GM_getValue('kb_api_base')) {
    GM_setValue('kb_api_base', API_BASE);
  }
  if (SESSION_COOKIE && SESSION_COOKIE !== '__SESSION_COOKIE__' && !GM_getValue('kb_session')) {
    GM_setValue('kb_session', SESSION_COOKIE);
  }

  // ---------- state ----------
  let startLine = 0;
  let endLine = 0;
  let selectedText = '';
  let version = '';
  let filePath = '';

  // ---------- helpers ----------
  function parseElixirUrl() {
    // /linux/v6.1/source/mm/mmap.c  or  /linux/v6.1/A/ident/mm/mmap.c
    const m = location.pathname.match(/^\/linux\/([^/]+)\/source\/(.+)$/);
    if (m) return { version: m[1], filePath: m[2] };
    const m2 = location.pathname.match(/^\/linux\/([^/]+)\/A\/ident\/(.+)$/);
    if (m2) return { version: m2[1], filePath: m2[2] };
    // some pages are /linux/v6.1/source/mm/  (directory listing)
    const m3 = location.pathname.match(/^\/linux\/([^/]+)\/source\/?$/);
    if (m3) return { version: m3[1], filePath: '' };
    return null;
  }

  function getAuthHeaders() {
    if (!SESSION_COOKIE || SESSION_COOKIE === '__SESSION_COOKIE__') return {};
    return { 'Cookie': SESSION_COOKIE };
  }

  function apiGet(path) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: API_BASE + path,
        headers: Object.assign({ 'Accept': 'application/json' }, getAuthHeaders()),
        onload: (r) => {
          if (r.status === 200) resolve(JSON.parse(r.responseText));
          else resolve(null);
        },
        onerror: () => resolve(null),
        ontimeout: () => resolve(null),
      });
    });
  }

  function apiPost(path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: API_BASE + path,
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        data: JSON.stringify(body),
        onload: (r) => {
          if (r.status >= 200 && r.status < 300) resolve(JSON.parse(r.responseText));
          else reject(new Error(r.responseText || 'API error ' + r.status));
        },
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  // ---------- UI ----------
  GM_addStyle(`
    #${PANEL_ID} {
      position: fixed; right: 16px; top: 80px; width: 380px; max-height: calc(100vh - 120px);
      background: #fff; border: 1px solid #e2e8f0; border-radius: 16px;
      box-shadow: 0 20px 60px rgba(15,23,42,0.15); z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; overflow-y: auto; display: none;
    }
    #${PANEL_ID}.open { display: block; }
    #${PANEL_ID} .kb-header {
      padding: 16px; border-bottom: 1px solid #f1f5f9;
      display: flex; justify-content: space-between; align-items: center;
    }
    #${PANEL_ID} .kb-header h3 { margin: 0; font-size: 14px; color: #0f172a; }
    #${PANEL_ID} .kb-close {
      border: none; background: none; font-size: 18px; cursor: pointer; color: #94a3b8;
    }
    #${PANEL_ID} .kb-body { padding: 16px; }
    #${PANEL_ID} .kb-loc {
      font-size: 12px; color: #64748b; margin-bottom: 12px;
      padding: 8px 12px; background: #f8fafc; border-radius: 8px;
    }
    #${PANEL_ID} .kb-loc a { color: #6366f1; }
    #${PANEL_ID} textarea {
      width: 100%; min-height: 80px; padding: 10px; border: 1px solid #e2e8f0;
      border-radius: 10px; font-size: 13px; resize: vertical; outline: none;
      box-sizing: border-box;
    }
    #${PANEL_ID} textarea:focus { border-color: #6366f1; }
    #${PANEL_ID} .kb-tags { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
    #${PANEL_ID} .kb-tag {
      font-size: 11px; padding: 3px 10px; border-radius: 9999px;
      cursor: pointer; border: 1px solid #e2e8f0; background: #fff; color: #475569;
    }
    #${PANEL_ID} .kb-tag.selected { background: #6366f1; color: #fff; border-color: #6366f1; }
    #${PANEL_ID} .kb-actions { margin-top: 14px; display: flex; gap: 8px; }
    #${PANEL_ID} .kb-btn {
      padding: 8px 16px; border-radius: 10px; font-size: 13px; cursor: pointer; border: none;
    }
    #${PANEL_ID} .kb-btn-primary { background: #6366f1; color: #fff; }
    #${PANEL_ID} .kb-btn-primary:hover { background: #4f46e5; }
    #${PANEL_ID} .kb-btn-ghost { background: #f1f5f9; color: #475569; }
    #${PANEL_ID} .kb-btn-ghost:hover { background: #e2e8f0; }
    #${PANEL_ID} .kb-existing { margin-top: 16px; border-top: 1px solid #f1f5f9; padding-top: 12px; }
    #${PANEL_ID} .kb-existing h4 { font-size: 12px; color: #94a3b8; margin-bottom: 8px; }
    #${PANEL_ID} .kb-existing-item {
      font-size: 12px; padding: 8px; margin-bottom: 6px;
      border: 1px solid #f1f5f9; border-radius: 8px; color: #334155;
    }
    #${PANEL_ID} .kb-error { color: #ef4444; font-size: 12px; margin-top: 8px; }
    #${PANEL_ID} .kb-success { color: #10b981; font-size: 12px; margin-top: 8px; }
    #${PANEL_ID} .kb-line-preview {
      font-family: monospace; font-size: 11px; background: #f8fafc;
      border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; margin-top: 8px;
      max-height: 120px; overflow-y: auto; white-space: pre; color: #475569;
    }
    .${DOT_CLASS} {
      position: absolute; right: 2px; top: 50%; transform: translateY(-50%);
      width: 6px; height: 6px; border-radius: 50%; background: #6366f1;
      cursor: pointer; z-index: 5;
    }
    /* make line number cells relative for dot positioning */
    .elixir-lineno { position: relative; }
  `);

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="kb-header">
        <h3>📝 代码注解</h3>
        <button class="kb-close">&times;</button>
      </div>
      <div class="kb-body"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('.kb-close').addEventListener('click', () => panel.classList.remove('open'));
    return panel;
  }

  function renderPanel(version, filePath, startLine, endLine, selectedText, existingAnnotations) {
    const panel = document.getElementById(PANEL_ID) || createPanel();
    const body = panel.querySelector('.kb-body');
    const elixirUrl = `https://elixir.bootlin.com/linux/${version}/source/${filePath}#L${startLine}`;
    const targetRef = version + ':' + filePath;

    body.innerHTML = `
      <div class="kb-loc">
        📍 <strong>${version}</strong> / ${filePath} / L${startLine}${endLine > startLine ? '-' + endLine : ''}
        <br><a href="${elixirUrl}" target="_blank">在 elixir 中打开 ↗</a>
      </div>
      <div class="kb-line-preview">${escapeHtml(selectedText)}</div>
      <textarea id="kb-annotation-body" placeholder="注解内容（Markdown）..."></textarea>
      <div class="kb-tags" id="kb-tag-list"></div>
      <input type="text" id="kb-tag-search" placeholder="搜索已有标签..." style="width:100%;padding:8px;margin-top:8px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;outline:none;box-sizing:border-box;">
      <div class="kb-actions">
        <button class="kb-btn kb-btn-primary" id="kb-save">保存注解</button>
        <button class="kb-btn kb-btn-ghost" id="kb-cancel">取消</button>
      </div>
      <div id="kb-msg"></div>
      ${existingAnnotations && existingAnnotations.length > 0 ? `
        <div class="kb-existing">
          <h4>已有注解 (${existingAnnotations.length})</h4>
          ${existingAnnotations.map(a => `
            <div class="kb-existing-item">
              <strong>${escapeHtml(a.author)}</strong> · L${a.start_line}${a.end_line > a.start_line ? '-' + a.end_line : ''}<br>
              ${escapeHtml((a.body || '').substring(0, 200))}
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;

    // load tags
    let allTags = [];
    let selectedTags = [];
    apiGet('/api/tags?flat=true').then(data => {
      if (data && Array.isArray(data)) allTags = data;
      else if (data && Array.isArray(data.tags)) allTags = data.tags;
      renderTags();
    });

    function renderTags() {
      const tagList = document.getElementById('kb-tag-list');
      if (!tagList) return;
      tagList.innerHTML = allTags.map(t => {
        const sel = selectedTags.includes(t.name);
        return `<span class="kb-tag${sel ? ' selected' : ''}" data-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>`;
      }).join('');
      tagList.querySelectorAll('.kb-tag').forEach(el => {
        el.addEventListener('click', () => {
          const name = el.dataset.tag;
          if (selectedTags.includes(name)) selectedTags = selectedTags.filter(n => n !== name);
          else selectedTags.push(name);
          renderTags();
        });
      });
    }

    // tag search
    const tagSearch = document.getElementById('kb-tag-search');
    if (tagSearch) {
      tagSearch.addEventListener('input', () => {
        const q = tagSearch.value.toLowerCase();
        document.querySelectorAll('#kb-tag-list .kb-tag').forEach(el => {
          el.style.display = el.dataset.tag.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }

    // save
    document.getElementById('kb-save').addEventListener('click', async () => {
      const body = document.getElementById('kb-annotation-body').value.trim();
      if (!body) { showMsg('请输入注解内容', 'error'); return; }

      const msgEl = document.getElementById('kb-msg');
      msgEl.textContent = '保存中...';
      msgEl.className = 'kb-error';

      try {
        // create annotation
        const ann = await apiPost('/api/annotations', {
          annotation_type: 'code',
          body: body,
          visibility: 'public',
          target_type: 'kernel_file',
          target_ref: targetRef,
          target_label: filePath,
          target_subtitle: version,
          version: version,
          file_path: filePath,
          start_line: startLine,
          end_line: endLine,
          anchor: { start_line: startLine, end_line: endLine, context: selectedText.substring(0, 500) },
        });

        // assign tags
        for (const tagName of selectedTags) {
          try {
            await apiPost('/api/tag-assignments', {
              tag_name: tagName,
              target_type: 'annotation',
              target_ref: ann.annotation_id,
              source_type: 'elixir_userscript',
            });
          } catch (e) { /* tag assignment failure is non-fatal */ }
        }

        showMsg('注解已保存', 'success');
        // refresh existing annotations
        setTimeout(() => {
          apiGet('/api/annotations?target_type=kernel_file&target_ref=' + encodeURIComponent(targetRef)).then(res => {
            renderPanel(version, filePath, startLine, endLine, selectedText, res ? res.annotations : []);
          });
        }, 500);
      } catch (e) {
        showMsg('保存失败: ' + (e.message || 'unknown error'), 'error');
      }
    });

    document.getElementById('kb-cancel').addEventListener('click', () => {
      panel.classList.remove('open');
    });

    panel.classList.add('open');
  }

  function showMsg(text, type) {
    const el = document.getElementById('kb-msg');
    if (!el) return;
    el.textContent = text;
    el.className = type === 'success' ? 'kb-success' : 'kb-error';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- line selection ----------
  function getLineNum(el) {
    // elixir line links: <a id="L300" href="#L300">300</a>
    if (!el) return 0;
    const id = el.id || el.getAttribute('name') || '';
    if (id.startsWith('L')) return parseInt(id.substring(1), 10) || 0;
    // try href
    const href = el.getAttribute('href') || '';
    if (href.startsWith('#L')) return parseInt(href.substring(2), 10) || 0;
    return 0;
  }

  function getLineText(lineNum) {
    // elixir wraps each line in <pre class="elixir-code"><code>...</code></pre>
    // or similar structure. Try finding the line content.
    const pre = document.querySelector('.elixir-code');
    if (!pre) {
      // try all <pre> elements
      const pres = document.querySelectorAll('pre');
      if (pres.length === 0) return '';
      // find pre that contains the most code-like content
      for (const p of pres) {
        const text = p.textContent || '';
        const lines = text.split('\n');
        if (lineNum > 0 && lineNum <= lines.length) return lines[lineNum - 1] || '';
      }
      return '';
    }
    const lines = (pre.textContent || '').split('\n');
    if (lineNum > 0 && lineNum <= lines.length) return lines[lineNum - 1] || '';
    return '';
  }

  function getSelectedLineRange() {
    // find all line number anchors clicked with Shift
    const selected = document.querySelectorAll('.elixir-lineno.selected, a[id^="L"]:focus-within');
    // alternative: track clicks ourselves
    return { start: startLine, end: endLine };
  }

  function handleLineClick(e) {
    const lineNum = getLineNum(e.target.closest('a[id^="L"], [name^="L"]') || e.target);
    if (!lineNum) return;

    if (e.shiftKey && startLine > 0) {
      // extend range
      endLine = lineNum;
      if (startLine > endLine) [startLine, endLine] = [endLine, startLine];
    } else {
      startLine = lineNum;
      endLine = lineNum;
    }

    // collect selected text
    const lines = [];
    for (let i = startLine; i <= endLine; i++) {
      lines.push(getLineText(i));
    }
    selectedText = lines.join('\n');

    if (e.shiftKey || startLine === endLine) {
      openAnnotationPanel();
    }
  }

  function openAnnotationPanel() {
    const parsed = parseElixirUrl();
    if (!parsed || !parsed.filePath) return;
    version = parsed.version;
    filePath = parsed.filePath;

    const targetRef = version + ':' + filePath;
    apiGet('/api/annotations?target_type=kernel_file&target_ref=' + encodeURIComponent(targetRef) + '&page_size=50').then(res => {
      const existing = res ? (res.annotations || []) : [];
      renderPanel(version, filePath, startLine, endLine, selectedText, existing);
    }).catch(() => {
      renderPanel(version, filePath, startLine, endLine, selectedText, []);
    });
  }

  // ---------- existing annotation dots ----------
  function loadExistingDots() {
    const parsed = parseElixirUrl();
    if (!parsed || !parsed.filePath) return;
    const targetRef = parsed.version + ':' + parsed.filePath;

    apiGet('/api/annotations?target_type=kernel_file&target_ref=' + encodeURIComponent(targetRef) + '&page_size=200').then(res => {
      const annotations = res ? (res.annotations || []) : [];
      clearDots();
      const seen = new Set();
      annotations.forEach(a => {
        const line = a.start_line || (a.anchor && a.anchor.start_line);
        if (line && !seen.has(line)) {
          seen.add(line);
          addDot(line, a.annotation_id);
        }
      });
    }).catch(() => {});
  }

  function clearDots() {
    document.querySelectorAll('.' + DOT_CLASS).forEach(d => d.remove());
  }

  function addDot(lineNum, annotationId) {
    // find the line number cell for this line
    const anchor = document.getElementById('L' + lineNum);
    if (!anchor) return;
    const parent = anchor.closest('td, span');
    if (!parent) return;
    if (!parent.style.position) parent.style.position = 'relative';
    const dot = document.createElement('span');
    dot.className = DOT_CLASS;
    dot.title = '点击查看注解 #' + annotationId;
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      startLine = lineNum;
      endLine = lineNum;
      selectedText = getLineText(lineNum);
      openAnnotationPanel();
    });
    parent.appendChild(dot);
  }

  // ---------- init ----------
  function init() {
    // intercept clicks on line number links
    document.addEventListener('click', (e) => {
      const target = e.target.closest('a[id^="L"], [name^="L"], .elixir-lineno a, .lineno a');
      if (target) {
        const lineNum = getLineNum(target);
        if (lineNum) {
          handleLineClick(e);
          // don't prevent default so navigation still works
        }
      }
    });

    // load existing annotation dots after page settles
    setTimeout(loadExistingDots, 1500);

    // re-load on SPA navigation (elixir uses PJAX-like navigation)
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(loadExistingDots, 1500);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // API base config via Tampermonkey menu
  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('设置 API 地址', () => {
      const url = prompt('API Base URL:', API_BASE);
      if (url) GM_setValue('kb_api_base', url);
    });
    GM_registerMenuCommand('设置 Session Cookie', () => {
      const session = prompt('Session Cookie (document.cookie from KB page):', GM_getValue('kb_session', ''));
      if (session !== null) GM_setValue('kb_session', session);
    });
  }

  init();
  console.log('[Kernel KB] elixir annotate userscript loaded');
})();
