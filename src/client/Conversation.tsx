import type { ChatStatus, DynamicToolUIPart, UIMessage } from 'ai'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AppTool, EmulatorState, ToolResult } from './api'
import LoadingState from './beautifui/LoadingState'
import ToolChips, { type ToolStep } from './beautifui/ToolChips'
import { defaultArgs } from './lib'
import { WidgetFrame, type WidgetLog } from './WidgetFrame'

type Shared = {
  state: EmulatorState
  theme: 'light' | 'dark'
  onFollowUp: (text: string) => void
  onLog: (entry: WidgetLog) => void
}

type Segment = { kind: 'text'; key: string; text: string } | { kind: 'tools'; key: string; calls: DynamicToolUIPart[] }

function segmentsOf(message: UIMessage) {
  const segments: Segment[] = []
  message.parts.forEach((part, index) => {
    if (part.type === 'text' && part.text.trim()) segments.push({ kind: 'text', key: `text-${index}`, text: part.text })
    if (part.type !== 'dynamic-tool') return
    const previous = segments.at(-1)
    if (previous?.kind === 'tools') previous.calls.push(part)
    else segments.push({ kind: 'tools', key: part.toolCallId, calls: [part] })
  })
  return segments
}

const invocationText = (tool: AppTool | undefined, done: boolean) =>
  String(tool?.meta[`openai/toolInvocation/${done ? 'invoked' : 'invoking'}`] ?? (done ? 'Called' : 'Calling…'))

function toStep(call: DynamicToolUIPart, tool: AppTool | undefined): ToolStep {
  const done = call.state === 'output-available'
  const result = done ? (call.output as ToolResult) : undefined
  const textLines = ((result?.content ?? []) as { type: string; text?: string }[]).flatMap((block) =>
    block.type === 'text' && block.text ? [{ text: block.text }] : [],
  )
  return {
    id: call.toolCallId,
    icon: tool?.annotations?.readOnlyHint ? 'read' : 'run',
    label: call.state === 'output-error' ? 'Failed' : invocationText(tool, done),
    chip: `${call.toolName} ${JSON.stringify(call.input ?? {})}`,
    mono: true,
    detailMono: true,
    detail:
      call.state === 'output-error'
        ? [{ text: call.errorText }]
        : [
            ...textLines,
            ...(result?.structuredContent ? [{ text: `structuredContent ${JSON.stringify(result.structuredContent)}`, tone: 'add' as const }] : []),
            ...(result?._meta ? [{ text: `_meta, widget only ${JSON.stringify(result._meta)}` }] : []),
          ],
  }
}

function ToolRun({ calls, state, theme, onFollowUp, onLog }: { calls: DynamicToolUIPart[] } & Shared) {
  const toolOf = (call: DynamicToolUIPart) => state.tools.find((tool) => tool.name === call.toolName)
  return (
    <div className="flex flex-col gap-3">
      <ToolChips
        steps={calls.map((call) => toStep(call, toolOf(call)))}
        diffs={[]}
        diffLines={{}}
        labels={{ header: `${calls.length} tool call${calls.length === 1 ? '' : 's'}` }}
      />
      {calls.map((call) => {
        const tool = toolOf(call)
        if (call.state !== 'output-available' || !tool?.resourceUri) return null
        return (
          <WidgetFrame
            key={call.toolCallId}
            callId={call.toolCallId}
            tool={tool}
            input={call.input}
            result={call.output as ToolResult}
            widget={state.widgets[tool.resourceUri]}
            sandboxOrigin={state.sandboxOrigin}
            theme={theme}
            locale={state.locale}
            onFollowUp={onFollowUp}
            onLog={onLog}
          />
        )
      })}
    </div>
  )
}

function Message({ message, ...shared }: { message: UIMessage } & Shared) {
  if (message.role === 'user') {
    const text = message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
    return (
      <div className="max-w-[85%] self-end rounded-[18px] bg-hover px-3.5 py-2 text-[14px] leading-[1.55] whitespace-pre-wrap text-ink">
        {text}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {segmentsOf(message).map((segment) =>
        segment.kind === 'text' ? (
          <div key={segment.key} className="prose-chat">
            <Markdown remarkPlugins={[remarkGfm]}>{segment.text}</Markdown>
          </div>
        ) : (
          <ToolRun key={segment.key} calls={segment.calls} {...shared} />
        ),
      )}
    </div>
  )
}

function Welcome({ state, onRunTool }: { state: EmulatorState; onRunTool: (tool: AppTool, args: unknown) => void }) {
  if (!state.connected) {
    return (
      <div className="flex flex-col items-center gap-2 pt-[16vh] text-center">
        <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-ink">Can't reach the MCP server</h1>
        <p className="font-mono text-[12px] text-ink-3">{state.serverUrl}</p>
        <p className="max-w-sm text-ink-2">Start it and this page reconnects on its own.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-2 pt-[16vh] text-center">
      <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-ink">{state.serverInfo?.name ?? 'Your app'} is connected</h1>
      <p className="max-w-sm text-ink-2">Ask for something the app can do, or run a tool yourself.</p>
      <div className="mt-3 flex max-w-md flex-wrap justify-center gap-1.5">
        {state.tools.map((tool) => (
          <button
            key={tool.name}
            type="button"
            onClick={() => onRunTool(tool, defaultArgs(tool))}
            className="inline-flex h-7 cursor-pointer items-center rounded-chip bg-surface px-2 font-mono text-[11.5px] text-ink shadow-btn transition-colors duration-100 hover:bg-hover"
          >
            /{tool.name}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Conversation({
  messages,
  status,
  error,
  onRunTool,
  ...shared
}: {
  messages: UIMessage[]
  status: ChatStatus
  error: Error | undefined
  onRunTool: (tool: AppTool, args: unknown) => void
} & Shared) {
  const tail = messages.at(-1)?.role === 'assistant' ? messages.at(-1)?.parts.at(-1) : undefined
  const waiting = status === 'submitted' || (status === 'streaming' && tail?.type !== 'text')
  const running = tail?.type === 'dynamic-tool' && tail.state !== 'output-available' ? tail : undefined
  const waitingLabel = running
    ? invocationText(
        shared.state.tools.find((tool) => tool.name === running.toolName),
        false,
      )
    : 'Thinking'

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-5 py-6">
      {messages.length === 0 && <Welcome state={shared.state} onRunTool={onRunTool} />}
      {messages.map((message) => (
        <Message key={message.id} message={message} {...shared} />
      ))}
      {waiting && <LoadingState label={waitingLabel} />}
      {error && (
        <p role="alert" className="rounded-card bg-red-tint px-3 py-2 text-[13px] text-red">
          {error.message}
        </p>
      )}
    </div>
  )
}
