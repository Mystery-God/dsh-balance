/**
 * dsh-balance — browser half. Renders three surfaces:
 *
 * 1. The Plugins-settings tab (「设置 → 插件 → 模型余额悬浮窗」): the master
 *    switch that shows/hides the floating window, plus a live balance preview.
 * 2. The floating balance card (bottom-right, draggable): provider balance,
 *    refresh / collapse / close buttons, 60s auto-refresh.
 * 3. When the master switch is off the card renders nothing.
 *
 * Both surfaces share one in-memory settings store; balance data comes from
 * the host's GET /api/dsh-balance/value (fetch through plain browser fetch —
 * real plugin halves are not sandboxed).
 *
 * Module contract: `window.__ModuleLoader__.load({ id, factory })` and the
 * factory exports `{ inject, apply }` — plain React via `require('react')`,
 * no JSX, no bundler.
 */
window.__ModuleLoader__.load({
  id: '@linxin666/dsh-balance',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { useState, useEffect, useRef } = React

    const API = {
      settings: '/api/dsh-balance/settings',
      value: '/api/dsh-balance/value',
    }

    const POLL_MS = 60000

    // ------------------------------------------------------------------ store
    const store = { settings: null, listeners: new Set() }
    function subscribe(listener) {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    }
    function notify() {
      for (const listener of [...store.listeners]) listener()
    }
    async function loadSettings() {
      const response = await fetch(API.settings)
      if (!response.ok) throw new Error('settings load failed: ' + response.status)
      store.settings = await response.json()
      notify()
      return store.settings
    }
    async function saveSettings(patch) {
      const response = await fetch(API.settings, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error('settings save failed: ' + response.status)
      store.settings = await response.json()
      notify()
      return store.settings
    }
    async function loadBalance(force) {
      const response = await fetch(API.value + (force ? '?force=1' : ''))
      if (!response.ok) throw new Error('balance fetch failed: ' + response.status)
      return response.json()
    }

    // ------------------------------------------------------------------ css
    const CSS = [
      '.dshb-tab{font-size:13px;line-height:1.6;color:inherit;max-width:560px;}',
      '.dshb-tab h3{margin:0 0 4px;font-size:15px;}',
      '.dshb-tab .dshb-desc{margin:0 0 14px;opacity:.65;}',
      '.dshb-row{display:flex;align-items:center;gap:10px;margin:10px 0;flex-wrap:wrap;}',
      '.dshb-row label{display:flex;align-items:center;gap:6px;cursor:pointer;}',
      '.dshb-btn{border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;',
      'border-radius:8px;padding:4px 12px;cursor:pointer;font-size:12px;}',
      '.dshb-btn:hover{background:rgba(128,128,128,.15);}',
      '.dshb-key-input{flex:1;min-width:200px;max-width:340px;padding:5px 10px;border-radius:8px;',
      'border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:12px;}',
      '.dshb-key-input::placeholder{opacity:.55;}',
      '.dshb-error{color:#ff8a8a;margin-top:8px;}',
      '.dshb-preview{margin-top:10px;padding:10px 12px;border:1px solid rgba(128,128,128,.3);border-radius:10px;max-width:340px;}',
      '.dshb-preview-amount{font-size:20px;font-weight:700;color:#3ddc84;font-variant-numeric:tabular-nums;}',
      '.dshb-preview-line{display:flex;justify-content:space-between;gap:8px;margin-top:4px;opacity:.8;}',
      '.dshb-preview-foot{margin-top:6px;font-size:11px;opacity:.55;text-align:right;}',
      '.dshb-card,.dshb-pill{position:fixed;z-index:2147483000;pointer-events:auto;box-sizing:border-box;',
      'font-family:ui-sans-serif,system-ui,"Segoe UI",sans-serif;user-select:none;-webkit-user-select:none;}',
      '.dshb-card{width:216px;background:rgba(22,24,31,.93);color:#e6e8f0;border:1px solid rgba(255,255,255,.10);',
      'border-radius:14px;box-shadow:0 10px 32px rgba(0,0,0,.45);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
      'overflow:hidden;font-size:12px;line-height:1.5;}',
      '.dshb-head{display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:grab;',
      'border-bottom:1px solid rgba(255,255,255,.07);touch-action:none;}',
      '.dshb-head:active{cursor:grabbing;}',
      '.dshb-title{flex:1;font-weight:600;color:#e6e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.dshb-btn-icon{border:0;background:transparent;color:#a8adbf;cursor:pointer;font-size:13px;line-height:1;',
      'padding:3px;border-radius:6px;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;}',
      '.dshb-btn-icon:hover{background:rgba(255,255,255,.12);color:#fff;}',
      '.dshb-body{padding:10px 12px;}',
      '.dshb-amount{font-size:22px;font-weight:700;color:#7ee0a3;letter-spacing:.2px;font-variant-numeric:tabular-nums;}',
      '.dshb-line{display:flex;justify-content:space-between;gap:8px;margin-top:6px;color:#b7bccb;}',
      '.dshb-val{color:#d7dae4;font-variant-numeric:tabular-nums;}',
      '.dshb-note{margin-top:6px;color:#8d93a5;font-size:11px;}',
      '.dshb-wait{color:#8d93a5;}',
      '.dshb-errtext{color:#ff8a8a;}',
      '.dshb-foot{margin-top:8px;color:#6f7484;font-size:10.5px;text-align:right;}',
      '.dshb-dot{width:8px;height:8px;border-radius:50%;background:#6f7484;flex:none;}',
      '.dshb-dot-ok{background:#3ddc84;box-shadow:0 0 6px rgba(61,220,132,.8);}',
      '.dshb-dot-err{background:#ff5d5d;}',
      '.dshb-dot-loading{background:#f5b83d;animation:dshb-pulse 1.2s ease-in-out infinite;}',
      '@keyframes dshb-pulse{0%,100%{opacity:.35}50%{opacity:1}}',
      '.dshb-pill{display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;cursor:pointer;',
      'background:rgba(22,24,31,.9);color:#e6e8f0;border:1px solid rgba(255,255,255,.10);',
      'box-shadow:0 6px 20px rgba(0,0,0,.4);font-size:12px;touch-action:none;}',
      '.dshb-pill-text{font-weight:600;font-variant-numeric:tabular-nums;}',
      '.dshb-coin{font-size:14px;font-weight:700;color:#7ee0a3;}',
    ].join('')

    function currencySymbol(code) {
      if (code === 'CNY') return '¥'
      if (code === 'USD') return '$'
      if (code === 'EUR') return '€'
      if (code === 'GBP') return '£'
      if (code === 'JPY') return '¥'
      return typeof code === 'string' && code.length > 0 ? code : ''
    }

    function formatValue(value) {
      if (typeof value === 'number') {
        return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      }
      return String(value)
    }

    // ------------------------------------------------------- settings tab
    function BalanceSettingsTab() {
      const [settings, setSettings] = useState(store.settings)
      const [preview, setPreview] = useState(null)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState(null)
      const keyRef = useRef(null)

      useEffect(() => {
        let alive = true
        loadSettings()
          .then((value) => { if (alive) setSettings(value) })
          .catch((e) => { if (alive) setError(String(e && e.message ? e.message : e)) })
        loadBalance(false)
          .then((value) => { if (alive) setPreview(value) })
          .catch(() => {})
        const off = subscribe(() => setSettings(store.settings))
        return () => { alive = false; off() }
      }, [])

      function refresh() {
        setLoading(true)
        setError(null)
        loadBalance(true)
          .then((value) => setPreview(value))
          .catch((e) => setError(String(e && e.message ? e.message : e)))
          .finally(() => setLoading(false))
      }

      function update(patch) {
        setError(null)
        saveSettings(patch)
          .then((value) => setSettings(value))
          .catch((e) => setError(String(e && e.message ? e.message : e)))
      }

      function saveKey() {
        const input = keyRef.current
        if (input === null) return
        const value = input.value.trim()
        if (value.length === 0) {
          setError('请输入 API key（或点「清除」恢复系统凭据）')
          return
        }
        setError(null)
        saveSettings({ apiKey: value })
          .then((next) => {
            setSettings(next)
            input.value = ''
            refresh()
          })
          .catch((e) => setError(String(e && e.message ? e.message : e)))
      }

      const ok = preview !== null && preview.ok === true
      const balances = ok && Array.isArray(preview.balances) ? preview.balances : []
      const main = balances.length > 0 ? balances[0] : null
      const rest = balances.slice(1)
      const sym = ok ? currencySymbol(preview.currency) : ''

      return React.createElement('div', { className: 'dshb-tab' },
        React.createElement('h3', null, '模型余额悬浮窗'),
        React.createElement('p', { className: 'dshb-desc' }, '右下角悬浮展示模型账户余额，每 60 秒自动刷新；关闭总开关后悬浮窗完全隐藏。'),
        React.createElement('div', { className: 'dshb-row' },
          React.createElement('input', {
            className: 'dshb-key-input',
            type: 'password',
            placeholder: settings !== null && settings.apiKeySet === true
              ? '已保存 ' + settings.apiKeyPreview + '（输入新 key 覆盖，留空点清除）'
              : '粘贴 API key（留空则使用系统凭据 DEEPSEEK_API_KEY）',
            ref: keyRef,
            onKeyDown: (e) => { if (e.key === 'Enter') saveKey() },
          }),
          React.createElement('button', { className: 'dshb-btn', onClick: saveKey }, '保存 Key'),
          settings !== null && settings.apiKeySet === true
            ? React.createElement('button', {
              className: 'dshb-btn',
              onClick: () => update({ apiKey: '' }).then(() => refresh()),
            }, '清除')
            : null),
        settings !== null && settings.apiKeySet === true
          ? React.createElement('div', { className: 'dshb-desc' }, '当前使用本插件保存的 Key（' + (settings.apiKeyPreview ?? '') + '），仅存于 ~/.dsh/balance/settings.json。')
          : (settings !== null && settings.keySource === 'credentials'
            ? React.createElement('div', { className: 'dshb-desc' }, '当前使用系统凭据（DEEPSEEK_API_KEY）。')
            : null),
        React.createElement('div', { className: 'dshb-row' },
          React.createElement('label', null,
            React.createElement('input', {
              type: 'checkbox',
              checked: settings !== null && settings.floatingWindow === true,
              onChange: (e) => update({ floatingWindow: e.target.checked }),
            }),
            '显示余额悬浮窗')),
        React.createElement('div', { className: 'dshb-row' },
          React.createElement('button', { className: 'dshb-btn', disabled: loading, onClick: refresh }, loading ? '查询中…' : '立即查询一次')),
        React.createElement('div', { className: 'dshb-preview' },
          loading && preview === null
            ? React.createElement('div', { className: 'dshb-wait' }, '正在查询余额…')
            : ok && main !== null
              ? React.createElement('div', null,
                  React.createElement('div', { className: 'dshb-preview-amount' }, sym + ' ' + formatValue(main.value)),
                  React.createElement('div', null, preview.provider + ' · ' + (preview.currency || '')),
                  rest.map((item, index) => React.createElement('div', { className: 'dshb-preview-line', key: 'l' + index },
                    React.createElement('span', null, item.label),
                    React.createElement('span', null, sym + ' ' + formatValue(item.value)))),
                  preview.note !== undefined && preview.note !== null && String(preview.note).length > 0
                    ? React.createElement('div', { className: 'dshb-wait' }, String(preview.note))
                    : null,
                  typeof preview.updatedAt === 'string'
                    ? React.createElement('div', { className: 'dshb-preview-foot' }, '更新于 ' + new Date(preview.updatedAt).toLocaleTimeString())
                    : null)
              : React.createElement('div', { className: 'dshb-errtext' }, preview !== null && preview.error ? preview.error : '尚未查询')),
        error !== null ? React.createElement('div', { className: 'dshb-error' }, error) : null)
    }

    // ------------------------------------------------------ floating card
    function BalanceFloat() {
      const [settings, setSettings] = useState(store.settings)
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(false)
      const [collapsed, setCollapsed] = useState(false)
      const [closed, setClosed] = useState(false)
      const [pos, setPos] = useState({ x: 16, y: 16 })
      const dragMoved = useRef(false)

      useEffect(() => {
        loadSettings().then((value) => setSettings(value)).catch(() => {})
        return subscribe(() => setSettings(store.settings))
      }, [])

      function refresh(force) {
        setLoading(true)
        loadBalance(force === true)
          .then((value) => { setData(value === null || value === undefined ? { ok: false, error: '空响应' } : value); setLoading(false) })
          .catch((e) => { setData({ ok: false, error: String((e && e.message) || e) }); setLoading(false) })
      }

      useEffect(() => {
        refresh(false)
        // Browser-native interval: the cordis guard requires `inject: ['timer']`
        // for ctx.interval, and a real plugin half has the full DOM API.
        const id = window.setInterval(() => refresh(false), POLL_MS)
        return () => window.clearInterval(id)
      }, [])

      function onDragStart(e) {
        if (e.button !== 0) return
        const el = e.currentTarget
        const sx = e.clientX
        const sy = e.clientY
        const ox = pos.x
        const oy = pos.y
        dragMoved.current = false
        try { el.setPointerCapture(e.pointerId) } catch (error) {}
        function move(ev) {
          const dx = ev.clientX - sx
          const dy = ev.clientY - sy
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved.current = true
          setPos({
            x: Math.max(0, Math.min(2000, ox - dx)),
            y: Math.max(0, Math.min(2000, oy - dy)),
          })
        }
        function up() {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          el.removeEventListener('pointercancel', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
      }

      function stopDrag(e) { e.stopPropagation() }

      if (settings === null || settings.floatingWindow !== true) return null

      const ok = data !== null && data.ok === true
      const status = loading && data === null ? 'loading' : (ok ? 'ok' : 'err')
      const balances = ok && Array.isArray(data.balances) ? data.balances : []
      const main = balances.length > 0 ? balances[0] : null
      const rest = balances.slice(1)
      const sym = ok ? currencySymbol(data.currency) : ''

      if (closed) {
        return React.createElement('div', {
          className: 'dshb-pill',
          style: { right: pos.x, bottom: pos.y },
          title: '显示模型余额',
          onPointerDown: onDragStart,
          onClick: () => { if (!dragMoved.current) setClosed(false) },
        }, React.createElement('span', { className: 'dshb-coin' }, '¥'))
      }

      if (collapsed) {
        return React.createElement('div', {
          className: 'dshb-pill',
          style: { right: pos.x, bottom: pos.y },
          title: '展开余额面板',
          onPointerDown: onDragStart,
          onClick: () => { if (!dragMoved.current) setCollapsed(false) },
        },
          React.createElement('span', { className: 'dshb-dot dshb-dot-' + status }),
          React.createElement('span', { className: 'dshb-pill-text' },
            (loading && data === null) ? '…'
              : (ok && main !== null) ? (sym + ' ' + formatValue(main.value))
              : '查询失败'))
      }

      return React.createElement('div', {
        className: 'dshb-card',
        style: { right: pos.x, bottom: pos.y },
      },
        React.createElement('div', { className: 'dshb-head', onPointerDown: onDragStart },
          React.createElement('span', { className: 'dshb-dot dshb-dot-' + status }),
          React.createElement('span', { className: 'dshb-title' }, (ok && data.provider) ? (data.provider + ' 余额') : '模型余额'),
          React.createElement('button', { className: 'dshb-btn-icon', title: '刷新', onPointerDown: stopDrag, onClick: () => refresh(true) }, '⟳'),
          React.createElement('button', { className: 'dshb-btn-icon', title: '收起', onPointerDown: stopDrag, onClick: () => setCollapsed(true) }, '–'),
          React.createElement('button', { className: 'dshb-btn-icon', title: '关闭', onPointerDown: stopDrag, onClick: () => setClosed(true) }, '×')),
        React.createElement('div', { className: 'dshb-body' },
          (loading && data === null)
            ? React.createElement('div', { className: 'dshb-wait' }, '正在查询余额…')
            : ok
              ? React.createElement('div', null,
                  React.createElement('div', { className: 'dshb-amount' },
                    main !== null ? (sym + ' ' + formatValue(main.value)) : '—'),
                  rest.map((item, index) => React.createElement('div', { className: 'dshb-line', key: 'b' + index },
                    React.createElement('span', null, item.label),
                    React.createElement('span', { className: 'dshb-val' }, sym + ' ' + formatValue(item.value)))),
                  (data.note !== undefined && data.note !== null && String(data.note).length > 0)
                    ? React.createElement('div', { className: 'dshb-note' }, String(data.note))
                    : null)
              : React.createElement('div', { className: 'dshb-errtext' }, data !== null ? data.error : '加载失败'),
          (ok && typeof data.updatedAt === 'string')
            ? React.createElement('div', { className: 'dshb-foot' }, '更新于 ' + new Date(data.updatedAt).toLocaleTimeString())
            : null))
    }

    // ---------------------------------------------------------------- plugin
    const inject = ['slots']

    function apply(ctx) {
      const style = document.createElement('style')
      style.id = 'dsh-balance-style'
      style.textContent = CSS
      document.head.append(style)
      ctx.effect(() => () => style.remove(), 'dsh-balance: styles')

      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'balance',
        order: 80,
        label: '模型余额悬浮窗',
      }, () => React.createElement(BalanceSettingsTab)))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-balance-float', label: '模型余额悬浮窗' },
        () => React.createElement(BalanceFloat),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
