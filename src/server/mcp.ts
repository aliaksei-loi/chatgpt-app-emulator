import { createHash, randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { config } from './config.js'

export const UI_MIME_TYPE = 'text/html;profile=mcp-app'

type Meta = Record<string, unknown>

export type AppTool = {
  name: string
  title?: string
  description?: string
  inputSchema: Tool['inputSchema']
  annotations?: Tool['annotations']
  meta: Meta
  resourceUri?: string
  modelVisible: boolean
  appVisible: boolean
}

export type WidgetResource = {
  uri: string
  mimeType?: string
  html: string
  meta: Meta
  hash: string
  cspDeclared: boolean
}

export type CallRecord = {
  id: string
  toolName: string
  input: unknown
  result?: CallToolResult
  resourceUri?: string
}

const calls = new Map<string, CallRecord>()
const widgetStates = new Map<string, unknown>()

const widgetSessionOf = (record: CallRecord) => (record.result?._meta?.['openai/widgetSessionId'] as string | undefined) ?? record.id
const sessionId = randomUUID()
let client: Client | undefined
let connecting: Promise<Client> | undefined

const newClient = () =>
  new Client(
    { name: 'chatgpt-app-emulator', version: '0.0.0' },
    { capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [UI_MIME_TYPE] } } } as never },
  )

async function connect() {
  const url = new URL(config.serverUrl)
  const streamable = newClient()
  try {
    await streamable.connect(new StreamableHTTPClientTransport(url))
    return streamable
  } catch (streamableError) {
    const legacy = newClient()
    try {
      await legacy.connect(new SSEClientTransport(url))
      return legacy
    } catch {
      throw streamableError
    }
  }
}

function getClient() {
  if (client) return Promise.resolve(client)
  const target = config.serverUrl
  connecting ??= connect()
    .then((next) => {
      if (target !== config.serverUrl) {
        void next.close().catch(() => undefined)
        throw new Error('The server changed while connecting.')
      }
      client = next
      return next
    })
    .finally(() => {
      connecting = undefined
    })
  return connecting
}

function drop(stale: Client) {
  if (client === stale) client = undefined
  void stale.close().catch(() => undefined)
}

async function withClient<T>(operation: (active: Client) => Promise<T>) {
  const first = await getClient()
  try {
    return await operation(first)
  } catch {
    drop(first)
    return operation(await getClient())
  }
}

function describeTool(tool: Tool): AppTool {
  const meta = (tool._meta ?? {}) as Meta
  const ui = (meta.ui ?? {}) as { resourceUri?: string; visibility?: string[] }
  const visibility = ui.visibility ?? ['model', 'app']
  const resourceUri =
    ui.resourceUri ?? (meta['ui/resourceUri'] as string | undefined) ?? (meta['openai/outputTemplate'] as string | undefined)
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    meta,
    resourceUri,
    modelVisible: visibility.includes('model') && meta['openai/visibility'] !== 'private',
    appVisible: visibility.includes('app'),
  }
}

export async function readWidget(uri: string): Promise<WidgetResource> {
  const { contents } = await withClient((active) => active.readResource({ uri }))
  const content = contents[0] as { mimeType?: string; text?: string; blob?: string; _meta?: Meta }
  const html = content.text ?? Buffer.from(content.blob ?? '', 'base64').toString('utf8')
  return {
    uri,
    mimeType: content.mimeType,
    html,
    meta: content._meta ?? {},
    cspDeclared: Boolean((content._meta?.ui as { csp?: unknown } | undefined)?.csp ?? content._meta?.['openai/widgetCSP']),
    hash: createHash('sha1').update(html).update(JSON.stringify(content._meta ?? {})).digest('hex').slice(0, 12),
  }
}

export const readResourceRaw = (uri: string) => withClient((active) => active.readResource({ uri }))

type WidgetSummary = { hash?: string; mimeType?: string; meta?: Meta; cspDeclared?: boolean; error?: string }

type Snapshot =
  | {
      connected: true
      serverUrl: string
      serverInfo: ReturnType<Client['getServerVersion']>
      instructions: string | undefined
      tools: AppTool[]
      widgets: Record<string, WidgetSummary>
    }
  | { connected: false; serverUrl: string; error: string; tools: AppTool[]; widgets: Record<string, WidgetSummary> }

const FRESH_FOR_MS = { local: 1000, remote: 15_000 }
const RETRY_AFTER_MS = { local: 1000, remote: 4000 }
const TOLERATED_FAILURES = 2
const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]']

let latest: { at: number; value: Snapshot } | undefined
let lastGood: Snapshot | undefined
let refreshing: Promise<Snapshot> | undefined
let failures = 0
let knownTools: AppTool[] = []

const serverKind = () => (LOOPBACK_NAMES.includes(new URL(config.serverUrl).hostname) ? 'local' : 'remote')

async function takeSnapshot(): Promise<Snapshot> {
  const serverUrl = config.serverUrl
  const { tools: listed } = await withClient((active) => active.listTools())
  const tools = listed.map(describeTool)
  const uris = [...new Set(tools.flatMap((tool) => (tool.resourceUri ? [tool.resourceUri] : [])))]
  const widgets = await Promise.all(
    uris.map(async (uri): Promise<[string, WidgetSummary]> => {
      try {
        const { hash, mimeType, meta, cspDeclared } = await readWidget(uri)
        return [uri, { hash, mimeType, meta, cspDeclared }]
      } catch (error) {
        return [uri, { error: String(error) }]
      }
    }),
  )
  const active = await getClient()
  return {
    connected: true,
    serverUrl,
    serverInfo: active.getServerVersion(),
    instructions: active.getInstructions(),
    tools,
    widgets: Object.fromEntries(widgets),
  }
}

async function refresh(): Promise<Snapshot> {
  const serverUrl = config.serverUrl
  try {
    const value = await takeSnapshot()
    if (serverUrl === config.serverUrl) {
      failures = 0
      lastGood = value
      knownTools = value.tools
    }
    return value
  } catch (error) {
    failures += 1
    if (lastGood && failures <= TOLERATED_FAILURES) return lastGood
    return { connected: false, serverUrl, error: error instanceof Error ? error.message : String(error), tools: [], widgets: {} }
  }
}

export function snapshot(): Promise<Snapshot> {
  const kind = serverKind()
  const maxAge = failures ? RETRY_AFTER_MS[kind] : FRESH_FOR_MS[kind]
  if (latest && Date.now() - latest.at < maxAge) return Promise.resolve(latest.value)
  refreshing ??= refresh()
    .then((value) => {
      if (value.serverUrl === config.serverUrl) latest = { at: Date.now(), value }
      return value
    })
    .finally(() => {
      refreshing = undefined
    })
  return refreshing
}

export function useServer(url: string) {
  config.serverUrl = new URL(url).href
  if (client) drop(client)
  latest = undefined
  lastGood = undefined
  failures = 0
  knownTools = []
  calls.clear()
  widgetStates.clear()
}

async function findTool(name: string) {
  if (!knownTools.length) await snapshot()
  return knownTools.find((candidate) => candidate.name === name)
}

export async function runTool(name: string, input: unknown, id: string = randomUUID()) {
  const tool = await findTool(name)
  await withClient((active) => active.ping())
  const active = await getClient()
  const result = (await active.callTool({
    name,
    arguments: (input ?? {}) as Record<string, unknown>,
    _meta: {
      'openai/locale': config.locale,
      'openai/userAgent': 'chatgpt-app-emulator',
      'openai/userLocation': { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      'openai/subject': 'emulator-user',
      'openai/session': sessionId,
    },
  })) as CallToolResult
  const record = { id, toolName: name, input, result, resourceUri: tool?.resourceUri }
  calls.set(id, record)
  return record
}

export const getCall = (id: string) => calls.get(id)

export async function restoreCall(id: string, toolName: string, input: unknown, result?: CallToolResult) {
  const known = calls.get(id)
  if (known) {
    known.result ??= result
    return
  }
  calls.set(id, { id, toolName, input, result, resourceUri: (await findTool(toolName))?.resourceUri })
}

export const getWidgetState = (record: CallRecord) => widgetStates.get(widgetSessionOf(record))

export function setWidgetState(id: string, state: unknown) {
  const record = calls.get(id)
  if (record) widgetStates.set(widgetSessionOf(record), state)
}

export function modelVisibleResult(result: CallToolResult) {
  return {
    ...(result.isError ? { isError: true } : {}),
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    content: result.content,
  }
}
