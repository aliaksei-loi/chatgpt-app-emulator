import { useId, useState, type ReactNode } from 'react'
import type { AppTool, EmulatorState, LogEntry } from './api'
import CodeBlock from './beautifui/CodeBlock'
import { Glyph, IconButton } from './Glyph'
import { defaultArgs, pretty } from './lib'

type Tab = 'tools' | 'bridge'

function Tag({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent'; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-[18px] shrink-0 items-center rounded-chip px-1.5 text-[10.5px] font-medium ${
        tone === 'accent' ? 'bg-accent-tint text-accent-ink' : 'bg-field text-ink-2'
      }`}
    >
      {children}
    </span>
  )
}

function ToolRow({ tool, onRun }: { tool: AppTool; onRun: (tool: AppTool, args: unknown) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [args, setArgs] = useState(() => pretty(defaultArgs(tool)))
  const [problem, setProblem] = useState('')
  const fieldId = useId()

  async function run() {
    setProblem('')
    try {
      await onRun(tool, JSON.parse(args))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left transition-colors duration-100 hover:bg-hover"
      >
        <span className={`text-ink-3 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}>
          <Glyph name="chevron" size={12} />
        </span>
        <span className="min-w-0 truncate font-mono text-[12.5px] text-ink">{tool.name}</span>
        {tool.resourceUri && <Tag tone="accent">UI</Tag>}
        {!tool.modelVisible && <Tag>app only</Tag>}
        {!tool.appVisible && <Tag>model only</Tag>}
      </button>
      {open && (
        <div className="flex flex-col gap-2 pr-3 pb-3 pl-8">
          {tool.description && <p className="text-[12.5px] leading-[1.5] text-ink-2">{tool.description}</p>}
          {tool.resourceUri && <p className="truncate font-mono text-[11.5px] text-ink-3">{tool.resourceUri}</p>}
          <label htmlFor={fieldId} className="text-[11.5px] font-medium text-ink-2">
            Arguments
          </label>
          <textarea
            id={fieldId}
            value={args}
            rows={Math.min(8, args.split('\n').length + 1)}
            spellCheck={false}
            onChange={(event) => setArgs(event.target.value)}
            className="w-full resize-y rounded-control bg-field p-2 font-mono text-[12px] leading-[1.5] text-ink shadow-inset-field outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
          {problem && (
            <p role="alert" className="text-[12px] text-red">
              {problem}
            </p>
          )}
          <button
            type="button"
            onClick={run}
            className="inline-flex h-7 w-fit cursor-pointer items-center gap-1.5 rounded-control bg-ink px-2.5 text-[12px] font-medium text-surface transition-transform duration-150 active:scale-[0.97]"
          >
            <Glyph name="play" size={11} />
            Run tool
          </button>
        </div>
      )}
    </div>
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false)
  const fromWidget = entry.direction === 'from-widget'
  return (
    <div className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors duration-100 hover:bg-hover"
      >
        <span className="shrink-0 text-ink-3 tabular-nums">{entry.time}</span>
        <span className={`shrink-0 ${fromWidget ? 'text-orange' : 'text-accent-ink'}`} title={fromWidget ? 'Widget to host' : 'Host to widget'}>
          {fromWidget ? '←' : '→'}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-ink">{entry.method}</span>
        <Tag>{entry.channel === 'mcp-apps' ? 'MCP Apps' : 'window.openai'}</Tag>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <CodeBlock lines={pretty(entry.payload ?? null).split('\n')} filename={`${entry.method}.json`} />
        </div>
      )}
    </div>
  )
}

export function Inspector({
  state,
  log,
  onRunTool,
  onClearLog,
}: {
  state: EmulatorState
  log: LogEntry[]
  onRunTool: (tool: AppTool, args: unknown) => Promise<void>
  onClearLog: () => void
}) {
  const [tab, setTab] = useState<Tab>('tools')
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'tools', label: 'Tools', count: state.tools.length },
    { key: 'bridge', label: 'Bridge', count: log.length },
  ]

  return (
    <aside className="flex w-[380px] shrink-0 flex-col overflow-hidden rounded-window bg-surface shadow-card">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={tab === item.key}
            onClick={() => setTab(item.key)}
            className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-control px-2.5 text-[12.5px] font-medium transition-colors duration-150 ${
              tab === item.key ? 'bg-hover text-ink' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {item.label}
            <span className="text-ink-3 tabular-nums">{item.count}</span>
          </button>
        ))}
        {tab === 'bridge' && log.length > 0 && (
          <div className="ml-auto">
            <IconButton label="Clear bridge log" onClick={onClearLog}>
              <Glyph name="trash" />
            </IconButton>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'tools' && state.tools.map((tool) => <ToolRow key={tool.name} tool={tool} onRun={onRunTool} />)}
        {tab === 'tools' && state.tools.length === 0 && (
          <p className="p-4 text-[12.5px] text-ink-3">{state.connected ? 'This server exposes no tools.' : 'Tools appear once the server is reachable.'}</p>
        )}
        {tab === 'bridge' && [...log].reverse().map((entry) => <LogRow key={entry.id} entry={entry} />)}
        {tab === 'bridge' && log.length === 0 && (
          <p className="p-4 text-[12.5px] text-ink-3">Render a widget to see the messages it exchanges with the host.</p>
        )}
      </div>
    </aside>
  )
}
