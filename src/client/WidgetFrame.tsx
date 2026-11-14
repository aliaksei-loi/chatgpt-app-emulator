import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import { useEffect, useRef, useState } from 'react'
import { callTool, readResource, restoreCall, saveWidgetState, type AppTool, type LogEntry, type ToolResult, type WidgetInfo } from './api'
import { Glyph, IconButton, type GlyphName } from './Glyph'
import { hostContextFor, MAX_INLINE_HEIGHT, styleVariables } from './hostContext'

export type DisplayMode = 'inline' | 'fullscreen' | 'pip'

export type WidgetLog = Omit<LogEntry, 'id' | 'time'>

export type ModelContext = { callId: string; toolName: string; text: string }

type Props = {
  callId: string
  appName: string
  tool: AppTool
  input: unknown
  inputComplete: boolean
  result: ToolResult | undefined
  widget: WidgetInfo | undefined
  sandboxOrigin: string
  theme: 'light' | 'dark'
  locale: string
  onFollowUp: (text: string) => void
  onModelContext: (context: ModelContext) => void
  onDisplayMode: (callId: string, mode: DisplayMode) => void
  onLog: (entry: WidgetLog) => void
}

const MAX_PIP_HEIGHT = 400
const MODES: { key: DisplayMode; label: string; icon: GlyphName }[] = [
  { key: 'inline', label: 'Show inline', icon: 'inline' },
  { key: 'fullscreen', label: 'Show fullscreen', icon: 'fullscreen' },
  { key: 'pip', label: 'Show picture in picture', icon: 'pip' },
]

function openWebLink(href: unknown) {
  const url = typeof href === 'string' && URL.canParse(href) ? new URL(href) : undefined
  const allowed = url?.protocol === 'http:' || url?.protocol === 'https:'
  if (allowed) window.open(url.href, '_blank', 'noopener')
  return allowed
}

export function WidgetFrame(props: Props) {
  const { callId, appName, tool, result, sandboxOrigin, theme, locale, widget } = props
  const frame = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<AppBridge | null>(null)
  const appReady = useRef(false)
  const reportsOwnSize = useRef(false)
  const delivered = useRef({ input: false, result: false, globals: false })
  const latest = useRef(props)
  latest.current = props
  const [mode, setMode] = useState<DisplayMode>('inline')
  const [height, setHeight] = useState(120)
  const [reloads, setReloads] = useState(0)
  const lastKnownHash = useRef(widget?.hash)
  if (widget?.hash) lastKnownHash.current = widget.hash
  const widgetHash = lastKnownHash.current

  const postGlobals = (globals: Record<string, unknown>) =>
    frame.current?.contentWindow?.postMessage({ emu: 'openai', type: 'set_globals', globals }, '*')

  const deliver = () => {
    const bridge = bridgeRef.current
    const current = latest.current
    if (!bridge || !appReady.current) return
    const args = (current.input ?? {}) as Record<string, unknown>
    if (!current.inputComplete) return void bridge.sendToolInputPartial({ arguments: args })
    if (!delivered.current.input) {
      delivered.current.input = true
      void bridge.sendToolInput({ arguments: args })
    }
    if (current.result && !delivered.current.result) {
      delivered.current.result = true
      void bridge.sendToolResult(current.result as never)
    }
  }

  useEffect(() => {
    const iframe = frame.current
    const target = iframe?.contentWindow
    if (!iframe || !target) return
    appReady.current = false
    reportsOwnSize.current = false
    delivered.current = { input: false, result: false, globals: Boolean(latest.current.result) }

    const log = (direction: WidgetLog['direction'], channel: WidgetLog['channel'], method: string, payload: unknown) =>
      latest.current.onLog({ callId, direction, channel, method, payload })
    const shareWithModel = (text: string) => latest.current.onModelContext({ callId, toolName: latest.current.tool.name, text })

    const bridge = new AppBridge(
      null,
      { name: 'chatgpt-app-emulator', version: '0.0.0' },
      {
        openLinks: {},
        serverTools: {},
        serverResources: {},
        logging: {},
        sandbox: {},
        message: { text: {} },
        updateModelContext: { text: {}, structuredContent: {} },
      },
      { hostContext: hostContextFor(latest.current.theme, 'inline', locale, callId, latest.current.tool) },
    )

    bridge.oncalltool = async (params) => (await callTool(params.name, params.arguments ?? {})).result as never
    bridge.onreadresource = async ({ uri }) => readResource(uri)
    bridge.onmessage = async ({ content }) => {
      const text = content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
      if (text) latest.current.onFollowUp(text)
      return {}
    }
    bridge.onopenlink = async ({ url }) => (openWebLink(url) ? {} : { isError: true })
    bridge.onrequestdisplaymode = async ({ mode: requested }) => {
      setMode(requested)
      return { mode: requested }
    }
    bridge.onsizechange = ({ height: next }) => {
      reportsOwnSize.current = true
      if (next) setHeight(next)
    }
    bridge.onupdatemodelcontext = async ({ content, structuredContent }) => {
      const text = (content ?? []).flatMap((block) => (block.type === 'text' ? [block.text] : []))
      shareWithModel([...text, structuredContent ? JSON.stringify(structuredContent) : ''].filter(Boolean).join('\n'))
      return {}
    }
    bridge.oninitialized = () => {
      appReady.current = true
      deliver()
    }

    const transport = new PostMessageTransport(target, target)
    const send = transport.send.bind(transport)
    transport.send = (message, options) => {
      log('to-widget', 'mcp-apps', 'method' in message ? message.method : 'response', message)
      return send(message, options)
    }

    const reply = (id: number, value?: unknown, error?: string) =>
      target.postMessage({ emu: 'openai', type: 'response', id, result: value, error }, '*')

    const onMessage = (event: MessageEvent) => {
      if (event.source !== target) return
      const data = event.data
      if (data?.jsonrpc === '2.0') {
        log('from-widget', 'mcp-apps', data.method ?? 'response', data)
        return
      }
      if (data?.emu !== 'openai') return
      if (data.method !== 'contentHeight') log('from-widget', 'window.openai', data.method, data.params)
      switch (data.method) {
        case 'callTool':
          callTool(data.params.name, data.params.args ?? {}).then(
            (response) => reply(data.id, response.result),
            (error) => reply(data.id, undefined, String(error)),
          )
          break
        case 'sendFollowUpMessage':
          latest.current.onFollowUp(data.params.prompt)
          reply(data.id, {})
          break
        case 'requestDisplayMode':
          setMode(data.params.mode)
          reply(data.id, { mode: data.params.mode })
          break
        case 'requestModal':
          reply(data.id, undefined, 'requestModal is not emulated yet')
          break
        case 'setWidgetState':
          void saveWidgetState(callId, data.params.state)
          shareWithModel(`Widget state: ${JSON.stringify(data.params.state?.modelContent ?? data.params.state)}`)
          break
        case 'openExternal':
          if (!openWebLink(data.params?.href)) log('to-widget', 'window.openai', 'openExternal blocked', data.params)
          break
        case 'requestClose':
          setMode('inline')
          break
        case 'notifyIntrinsicHeight':
          if (data.params.height) setHeight(data.params.height)
          break
        case 'contentHeight':
          if (data.params.height && !reportsOwnSize.current) setHeight(data.params.height)
          break
      }
    }

    window.addEventListener('message', onMessage)
    bridgeRef.current = bridge
    const query = new URLSearchParams({
      call: callId,
      theme: latest.current.theme,
      displayMode: 'inline',
      locale,
      maxHeight: String(MAX_INLINE_HEIGHT),
      v: `${widgetHash ?? ''}.${reloads}`,
    })
    void bridge
      .connect(transport)
      .then(() => restoreCall(callId, latest.current.tool.name, latest.current.input, latest.current.result))
      .then(() => {
        iframe.src = `${sandboxOrigin}/?${query}`
      })

    return () => {
      window.removeEventListener('message', onMessage)
      bridgeRef.current = null
      void bridge.close()
    }
  }, [callId, sandboxOrigin, locale, widgetHash, reloads])

  useEffect(deliver, [props.input, props.inputComplete, result])

  useEffect(() => {
    if (!result || delivered.current.globals) return
    delivered.current.globals = true
    void restoreCall(callId, latest.current.tool.name, latest.current.input, result)
    postGlobals({ toolOutput: result.structuredContent ?? null, toolResponseMetadata: result._meta ?? null })
  }, [callId, result])

  useEffect(() => {
    const maxHeight = mode === 'fullscreen' ? (frame.current?.clientHeight ?? MAX_INLINE_HEIGHT) : MAX_INLINE_HEIGHT
    postGlobals({ theme, displayMode: mode, maxHeight })
    latest.current.onDisplayMode(callId, mode)
    if (appReady.current) {
      void bridgeRef.current?.sendHostContextChange({
        theme,
        displayMode: mode,
        containerDimensions: { maxHeight },
        styles: { variables: styleVariables(theme) },
      })
    }
  }, [callId, theme, mode])

  useEffect(() => () => latest.current.onDisplayMode(callId, 'inline'), [callId])

  const meta = widget?.meta ?? {}
  const prefersBorder = (meta.ui as { prefersBorder?: boolean } | undefined)?.prefersBorder ?? meta['openai/widgetPrefersBorder']
  const shell = {
    inline: 'flex flex-col gap-1',
    fullscreen: 'fixed inset-0 z-20 bg-surface',
    pip: 'fixed inset-x-0 top-3 z-20 mx-auto w-[min(720px,calc(100%-48px))] overflow-hidden rounded-3xl bg-surface shadow-overlay',
  }[mode]
  const stage = {
    inline: prefersBorder ? 'overflow-hidden rounded-2xl border border-line' : '',
    fullscreen: 'h-full',
    pip: '',
  }[mode]
  const frameHeight = {
    inline: Math.min(Math.max(height, 60), MAX_INLINE_HEIGHT),
    fullscreen: '100%',
    pip: Math.min(Math.max(height, 200), MAX_PIP_HEIGHT),
  }[mode]

  return (
    <div>
      <div className={shell}>
        {mode === 'inline' ? (
          <div className="flex h-9 shrink-0 items-center gap-2 text-[11.5px]">
            <span className="shrink-0 text-ink">
              <Glyph name="spark" size={15} />
            </span>
            <span className="min-w-0 truncate text-[14px] text-ink-2" title={`${tool.title ?? tool.name} (${tool.resourceUri})`}>
              {appName}
            </span>
            {widget?.cspDeclared === false && (
              <span
                className="inline-flex h-[18px] shrink-0 items-center rounded-chip bg-orange-tint px-1.5 text-[10.5px] font-medium text-orange"
                title="This widget declares no CSP, so it loads without restrictions. Plugin review checks the declared policy."
              >
                No CSP declared
              </span>
            )}
            <div className="ml-auto flex items-center">
              {MODES.map((option) => (
                <IconButton key={option.key} label={option.label} active={mode === option.key} onClick={() => setMode(option.key)}>
                  <Glyph name={option.icon} />
                </IconButton>
              ))}
              <IconButton label="Reload widget" onClick={() => setReloads((count) => count + 1)}>
                <Glyph name="reload" />
              </IconButton>
            </div>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Close"
            title="Back to inline"
            onClick={() => setMode('inline')}
            className={`absolute top-3 left-3 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full shadow-raised transition-transform duration-150 active:scale-[0.94] ${
              mode === 'pip' ? 'bg-ink text-surface' : 'bg-surface text-ink'
            }`}
          >
            <Glyph name="close" size={16} />
          </button>
        )}
        <div className={stage}>
          <iframe
            ref={frame}
            title={tool.title ?? tool.name}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="block w-full border-0"
            style={{ height: frameHeight, colorScheme: theme }}
          />
        </div>
      </div>
      {mode !== 'inline' && <p className="text-[12px] text-ink-3">Showing in {mode === 'pip' ? 'picture in picture' : 'fullscreen'}.</p>}
    </div>
  )
}
