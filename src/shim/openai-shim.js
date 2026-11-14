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
  window.webplus = api

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
    let scheduled = false
    const report = () => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const root = document.documentElement
        const previous = root.style.height
        root.style.height = 'fit-content'
        const height = Math.ceil(root.getBoundingClientRect().height)
        root.style.height = previous
        notify('contentHeight', { height })
      })
    }
    const observer = new ResizeObserver(report)
    observer.observe(document.documentElement)
    observer.observe(document.body)
    report()
  })
})()
