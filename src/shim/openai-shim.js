;(() => {
  const boot = window.__EMU_BOOT__
  const pending = new Map()
  let sequence = 0

  const post = (message) => window.parent.postMessage({ emu: 'openai', ...message }, '*')
  const notify = (method, params) => post({ method, params })
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      post({ id, method, params })
    })
  const unsupported = (method) => () => {
    notify('unsupported', { method })
    return Promise.reject(new Error(`${method} is not emulated yet`))
  }

  const api = {
    ...boot.globals,
    callTool: (name, args) => request('callTool', { name, args }),
    sendFollowUpMessage: (params) => request('sendFollowUpMessage', params),
    requestDisplayMode: (params) => request('requestDisplayMode', params),
    requestModal: (params) => request('requestModal', params),
    setWidgetState: (state) => {
      api.widgetState = state
      notify('setWidgetState', { state })
    },
    openExternal: (params) => notify('openExternal', params),
    setOpenInAppUrl: (params) => notify('setOpenInAppUrl', params),
    requestClose: () => notify('requestClose'),
    notifyIntrinsicHeight: (height) => notify('notifyIntrinsicHeight', { height: Number(height?.height ?? height) }),
    uploadFile: unsupported('uploadFile'),
    selectFiles: unsupported('selectFiles'),
    getFileDownloadUrl: unsupported('getFileDownloadUrl'),
    requestCheckout: unsupported('requestCheckout'),
  }
  window.openai = api

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const data = event.data
    if (!data || data.emu !== 'openai') return
    if (data.type === 'response') {
      const entry = pending.get(data.id)
      if (!entry) return
      pending.delete(data.id)
      if (data.error) entry.reject(new Error(data.error))
      else entry.resolve(data.result)
    }
    if (data.type === 'set_globals') {
      Object.assign(api, data.globals)
      if (data.globals.locale) document.documentElement.lang = data.globals.locale
      window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: data.globals } }))
    }
  })

  document.documentElement.lang = boot.globals.locale
  document.addEventListener('securitypolicyviolation', (event) => {
    notify('cspViolation', { directive: event.violatedDirective, blockedURI: event.blockedURI })
  })
  window.addEventListener('error', (event) => notify('widgetError', { message: event.message }))
  window.addEventListener('DOMContentLoaded', () => {
    const report = () => {
      const body = document.body
      const bottom = body.getBoundingClientRect().bottom + window.scrollY + parseFloat(getComputedStyle(body).marginBottom)
      notify('contentHeight', { height: Math.ceil(bottom) })
    }
    new ResizeObserver(report).observe(document.body)
    report()
  })
})()
