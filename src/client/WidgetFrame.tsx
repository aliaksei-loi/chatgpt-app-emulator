import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import { useEffect, useRef, useState } from 'react'
import { callTool, readResource, restoreCall, saveWidgetState, type AppTool, type LogEntry, type ToolResult, type WidgetInfo } from './api'
import { Glyph, IconButton, type GlyphName } from './Glyph'

type DisplayMode = 'inline' | 'fullscreen' | 'pip'

export type WidgetLog = Omit<LogEntry, 'id' | 'time'>

type Props = {
  callId: string
  tool: AppTool
  input: unknown
  result: ToolResult
  widget: WidgetInfo | undefined
  sandboxOrigin: string
  theme: 'light' | 'dark'
  locale: string
  onFollowUp: (text: string) => void
  onLog: (entry: WidgetLog) => void
}

const MAX_INLINE_HEIGHT = 480
const PIP_HEIGHT = 280
const MODES: { key: DisplayMode; label: string; icon: GlyphName }[] = [
  { key: 'inline', label: 'Show inline', icon: 'inline' },
  { key: 'fullscreen', label: 'Show fullscreen', icon: 'fullscreen' },
  { key: 'pip', label: 'Show picture in picture', icon: 'pip' },
]

export function WidgetFrame(props: Props) {
  const { callId, tool, sandboxOrigin, theme, locale, widget } = props
  const frame = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<AppBridge | null>(null)
  const appReady = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const [mode, setMode] = useState<DisplayMode>('inline')
  const [height, setHeight] = useState(120)
  const [reloads, setReloads] = useState(0)
  const lastKnownHash = useRef(widget?.hash)
  if (widget?.hash) lastKnownHash.current = widget.hash
  const widgetHash = lastKnownHash.current

  useEffect(() => {
    const iframe = frame.current
    const target = iframe?.contentWindow
    if (!iframe || !target) return
    appReady.current = false

    const log = (direction: WidgetLog['direction'], channel: WidgetLog['channel'], method: string, payload: unknown) =>
      latest.current.onLog({ callId, direction, channel, method, payload })

    const bridge = new AppBridge(
      null,
      { name: 'chatgpt-app-emulator', version: '0.0.0' },
      {
        openLinks: {},
        serverTools: {},
        serverResources: {},
        logging: {},
        message: { text: {} },
        updateModelContext: { text: {}, structuredContent: {} },
      },
      {
        hostContext: {
          theme: latest.current.theme,
          displayMode: 'inline',
          availableDisplayModes: ['inline', 'fullscreen', 'pip'],
          containerDimensions: { maxHeight: MAX_INLINE_HEIGHT },
          locale,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          userAgent: 'chatgpt-app-emulator',
          platform: 'web',
          deviceCapabilities: { hover: true, touch: false },
          safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      },
    )

    bridge.oncalltool = async (params) => (await callTool(params.name, params.arguments ?? {})).result as never
    bridge.onreadresource = async ({ uri }) => readResource(uri)
    bridge.onmessage = async ({ content }) => {
      const text = content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
      if (text) latest.current.onFollowUp(text)
      return {}
    }
    bridge.onopenlink = async ({ url }) => {
      window.open(url, '_blank', 'noopener')
      return {}
    }
    bridge.onrequestdisplaymode = async ({ mode: requested }) => {
      setMode(requested)
      return { mode: requested }
    }
    bridge.onsizechange = ({ height: next }) => {
      if (next) setHeight(next)
    }
    bridge.onupdatemodelcontext = async () => ({})
    bridge.oninitialized = () => {
      appReady.current = true
      void bridge.sendToolInput({ arguments: (latest.current.input ?? {}) as Record<string, unknown> })
      void bridge.sendToolResult(latest.current.result as never)
    }

    const transport = new PostMessageTransport(target, target)
    const send = transport.send.bind(transport)
    transport.send = (message, options) => {
      log('to-widget', 'mcp-apps', 'method' in message ? message.method : 'response', message)
      return send(message, options)
    }

    const reply = (id: number, result?: unknown, error?: string) =>
      target.postMessage({ emu: 'openai', type: 'response', id, result, error }, '*')

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
          break
        case 'openExternal':
          window.open(data.params.href, '_blank', 'noopener')
          break
        case 'requestClose':
          setMode('inline')
          break
        case 'notifyIntrinsicHeight':
        case 'contentHeight':
          if (data.params.height) setHeight(data.params.height)
          break
      }
    }

    window.addEventListener('message', onMessage)
    bridgeRef.current = bridge
    const query = new URLSearchParams({
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
        iframe.src = `${sandboxOrigin}/widget/${callId}?${query}`
      })

    return () => {
      window.removeEventListener('message', onMessage)
      bridgeRef.current = null
      void bridge.close()
    }
  }, [callId, sandboxOrigin, locale, widgetHash, reloads])

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ emu: 'openai', type: 'set_globals', globals: { theme, displayMode: mode } }, '*')
    if (appReady.current) void bridgeRef.current?.sendHostContextChange({ theme, displayMode: mode })
  }, [theme, mode])

  const meta = widget?.meta ?? {}
  const prefersBorder = (meta.ui as { prefersBorder?: boolean } | undefined)?.prefersBorder ?? meta['openai/widgetPrefersBorder']
  const shell = {
    inline: 'flex flex-col gap-1',
    fullscreen: 'fixed inset-0 z-20 flex flex-col bg-surface',
    pip: 'fixed right-4 bottom-4 z-20 flex w-[360px] flex-col overflow-hidden rounded-window bg-surface shadow-overlay',
  }[mode]
  const stage = {
    inline: `overflow-hidden rounded-card bg-surface ${prefersBorder ? 'shadow-card' : ''}`,
    fullscreen: 'min-h-0 flex-1',
    pip: '',
  }[mode]
  const frameHeight = { inline: Math.min(Math.max(height, 60), MAX_INLINE_HEIGHT), fullscreen: '100%', pip: PIP_HEIGHT }[mode]

  return (
    <div>
      <div className={shell}>
        <div className={`flex h-8 shrink-0 items-center gap-2 text-[11.5px] ${mode === 'inline' ? '' : 'border-b border-line px-3'}`}>
          <span className="shrink-0 font-medium text-ink-2">{tool.title ?? tool.name}</span>
          <span className="min-w-0 truncate font-mono text-ink-3">{tool.resourceUri}</span>
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
        <div className={stage}>
          <iframe
            ref={frame}
            title={tool.title ?? tool.name}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="block w-full border-0"
            style={{ height: frameHeight }}
          />
        </div>
      </div>
      {mode !== 'inline' && <p className="text-[12px] text-ink-3">Showing in {mode === 'pip' ? 'picture in picture' : 'fullscreen'}.</p>}
    </div>
  )
}
