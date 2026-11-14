import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type DynamicToolUIPart, type UIMessage } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { callTool, connectServer, fetchState, startExample, type AppTool, type EmulatorState, type LogEntry } from './api'
import PromptBar from './beautifui/PromptBar'
import { Conversation } from './Conversation'
import { ExamplesMenu } from './ExamplesMenu'
import { Glyph, IconButton } from './Glyph'
import { Inspector } from './Inspector'
import { parseToolCommand } from './lib'
import type { DisplayMode, ModelContext, WidgetLog } from './WidgetFrame'

type Theme = 'light' | 'dark'

const THEME_KEY = 'emulator-theme'
const MODEL_KEY = 'emulator-model'
const CHAT_KEY = 'emulator-chat'

function restoreChat(): UIMessage[] {
  try {
    return JSON.parse(sessionStorage.getItem(CHAT_KEY) ?? '[]')
  } catch {
    return []
  }
}
const WIDE_ENOUGH_FOR_INSPECTOR = 1000

function ServerUrl({ url, onChange }: { url: string; onChange: (next: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <button
        type="button"
        title="Connect to another MCP server"
        onClick={() => setDraft(url)}
        className="min-w-0 cursor-pointer truncate rounded-chip px-1 py-0.5 font-mono text-[11.5px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink-2"
      >
        {url}
      </button>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (draft && draft.trim() !== url) onChange(draft.trim())
    setDraft(null)
  }

  return (
    <form className="min-w-0 flex-1" onSubmit={submit}>
      <input
        autoFocus
        aria-label="MCP server URL"
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => event.key === 'Escape' && setDraft(null)}
        className="w-full rounded-chip bg-field px-1.5 py-0.5 font-mono text-[11.5px] text-ink shadow-inset-field outline-none"
      />
    </form>
  )
}

export function App() {
  const [state, setState] = useState<EmulatorState | null>(null)
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'))
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= WIDE_ENOUGH_FOR_INSPECTOR)
  const [log, setLog] = useState<LogEntry[]>([])
  const [notice, setNotice] = useState('')
  const [fullscreenCall, setFullscreenCall] = useState<string | null>(null)
  const [chosenModel, setChosenModel] = useState(() => localStorage.getItem(MODEL_KEY) ?? '')
  const logId = useRef(0)
  const serialized = useRef('')
  const scroller = useRef<HTMLDivElement>(null)
  const modelRef = useRef(chosenModel)
  modelRef.current = chosenModel
  const widgetContext = useRef(new Map<string, ModelContext>())
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: () => ({ model: modelRef.current || undefined, context: [...widgetContext.current.values()] }) }),
    [],
  )
  const restored = useMemo(restoreChat, [])
  const { messages, sendMessage, setMessages, status, error, stop } = useChat({ transport, messages: restored })
  const busy = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    let active = true
    const refresh = async () => {
      const next = await fetchState().catch(() => null)
      if (!active || !next) return
      const text = JSON.stringify(next)
      if (text === serialized.current) return
      serialized.current = text
      setState(next)
    }
    void refresh()
    const timer = setInterval(refresh, 1500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('theme-switching')
    root.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_KEY, theme)
    const settle = setTimeout(() => root.classList.remove('theme-switching'), 60)
    return () => clearTimeout(settle)
  }, [theme])

  useEffect(() => {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages.length, status])

  useEffect(() => {
    if (status === 'ready') sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages))
  }, [messages, status])

  const addLog = useCallback((entry: WidgetLog) => {
    setLog((current) => [...current.slice(-299), { ...entry, id: ++logId.current, time: new Date().toLocaleTimeString() }])
  }, [])

  const shareWithModel = useCallback((context: ModelContext) => void widgetContext.current.set(context.callId, context), [])

  const trackDisplayMode = useCallback((callId: string, mode: DisplayMode) => {
    setFullscreenCall((current) => (mode === 'fullscreen' ? callId : current === callId ? null : current))
  }, [])

  const followUp = useCallback((text: string) => void sendMessage({ text }), [sendMessage])

  const runTool = useCallback(
    async (tool: AppTool, args: unknown) => {
      const { callId, result } = await callTool(tool.name, args)
      const call: DynamicToolUIPart = {
        type: 'dynamic-tool',
        toolName: tool.name,
        toolCallId: callId,
        state: 'output-available',
        input: args,
        output: result,
      }
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: `/${tool.name} ${JSON.stringify(args)}` }] },
        { id: crypto.randomUUID(), role: 'assistant', parts: [call] },
      ])
    },
    [setMessages],
  )

  if (!state) return null

  const model = state.models.some((option) => option.key === chosenModel) ? chosenModel : state.model
  const commands = state.tools.map((tool) => ({ key: tool.name, name: `/${tool.name}`, desc: tool.title ?? tool.description ?? '' }))

  function submit(text: string) {
    setNotice('')
    try {
      const command = parseToolCommand(text, state!.tools)
      if (!command) return void sendMessage({ text })
      runTool(command.tool, command.args).catch((problem) => setNotice(String(problem)))
    } catch {
      setNotice(`The arguments after ${text.split(/\s/)[0]} must be valid JSON.`)
    }
  }

  return (
    <div className="flex h-full gap-3 p-3">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-window bg-surface shadow-card">
        <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line pr-2 pl-4">
          <span
            className={`size-2 shrink-0 rounded-full ${state.connected ? 'bg-green' : 'bg-red'}`}
            title={state.connected ? 'Connected' : 'Disconnected'}
          />
          <span className="shrink-0 text-[13px] font-medium text-ink">{state.serverInfo?.name ?? 'Not connected'}</span>
          <ServerUrl
            url={state.serverUrl}
            onChange={(url) => {
              setNotice('')
              connectServer(url).then(
                () => {
                  widgetContext.current.clear()
                  setLog([])
                  setMessages([])
                },
                (problem) => setNotice(problem instanceof Error ? problem.message : String(problem)),
              )
            }}
          />
          <div className="ml-auto flex shrink-0 items-center">
            <ExamplesMenu
              examples={state.examples}
              onStart={(id) => {
                widgetContext.current.clear()
                setLog([])
                setNotice('')
                setMessages([])
                void startExample(id)
              }}
            />
            <IconButton
              label="Start a new chat"
              onClick={() => {
                widgetContext.current.clear()
                setMessages([])
              }}
            >
              <Glyph name="compose" />
            </IconButton>
            <IconButton label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <Glyph name={theme === 'dark' ? 'sun' : 'moon'} />
            </IconButton>
            <IconButton label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} active={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}>
              <Glyph name="panel" />
            </IconButton>
          </div>
        </header>

        <div className="relative min-h-0 flex-1 [contain:layout]">
          <div ref={scroller} className="h-full overflow-y-auto">
            <Conversation
              messages={messages}
              status={status}
              error={error}
              state={state}
              theme={theme}
              onFollowUp={followUp}
              onModelContext={shareWithModel}
              onDisplayMode={trackDisplayMode}
              onLog={addLog}
              onRunTool={(tool, args) => void runTool(tool, args).catch((problem) => setNotice(String(problem)))}
              onPrompt={followUp}
            />
          </div>
        </div>

        <div className="mx-auto w-full max-w-[768px] px-6 pb-4">
          {notice && (
            <p role="alert" className="mb-2 text-[12.5px] text-red">
              {notice}
            </p>
          )}
          <PromptBar
            key={state.models.map((option) => option.key).join()}
            demo={false}
            placeholder={fullscreenCall ? `Ask ${state.serverInfo?.name ?? 'the app'}` : 'Ask the app, or type / to run a tool'}
            sources={[]}
            commands={commands}
            models={state.models}
            model={model}
            onModelChange={(key) => {
              setChosenModel(key)
              localStorage.setItem(MODEL_KEY, key)
            }}
            busy={busy}
            onStop={() => void stop()}
            onSend={submit}
          />
        </div>
      </section>

      {inspectorOpen && <Inspector state={state} log={log} onRunTool={runTool} onClearLog={() => setLog([])} />}
    </div>
  )
}
