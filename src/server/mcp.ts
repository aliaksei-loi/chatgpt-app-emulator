import { createHash, randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
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
}

export type CallRecord = {
  id: string
  toolName: string
  input: unknown
  result: CallToolResult
  resourceUri?: string
  widgetState?: unknown
}

const calls = new Map<string, CallRecord>()
const sessionId = randomUUID()
let client: Client | undefined

async function connect() {
  const next = new Client(
    { name: 'chatgpt-app-emulator', version: '0.0.0' },
    { capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [UI_MIME_TYPE] } } } as never },
  )
  await next.connect(new StreamableHTTPClientTransport(new URL(config.serverUrl)))
  client = next
  return next
}

async function fresh() {
  if (client) {
    try {
      await client.ping()
      return client
    } catch {
      client = undefined
    }
  }
  return connect()
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

export async function listTools() {
  const { tools } = await (await fresh()).listTools()
  return tools.map(describeTool)
}

export async function readWidget(uri: string): Promise<WidgetResource> {
  const { contents } = await (await fresh()).readResource({ uri })
  const content = contents[0] as { mimeType?: string; text?: string; blob?: string; _meta?: Meta }
  const html = content.text ?? Buffer.from(content.blob ?? '', 'base64').toString('utf8')
  return {
    uri,
    mimeType: content.mimeType,
    html,
    meta: content._meta ?? {},
    hash: createHash('sha1').update(html).update(JSON.stringify(content._meta ?? {})).digest('hex').slice(0, 12),
  }
}

export async function readResourceRaw(uri: string) {
  return (await fresh()).readResource({ uri })
}

export async function snapshot() {
  try {
    const active = await fresh()
    const tools = await listTools()
    const uris = [...new Set(tools.flatMap((tool) => (tool.resourceUri ? [tool.resourceUri] : [])))]
    const widgets = await Promise.all(
      uris.map(async (uri) => {
        try {
          const { hash, mimeType, meta } = await readWidget(uri)
          return [uri, { hash, mimeType, meta }] as const
        } catch (error) {
          return [uri, { error: String(error) }] as const
        }
      }),
    )
    return {
      connected: true as const,
      serverUrl: config.serverUrl,
      serverInfo: active.getServerVersion(),
      instructions: active.getInstructions(),
      tools,
      widgets: Object.fromEntries(widgets),
    }
  } catch (error) {
    return { connected: false as const, serverUrl: config.serverUrl, error: String(error), tools: [], widgets: {} }
  }
}

export async function runTool(name: string, input: unknown, id: string = randomUUID()) {
  const active = await fresh()
  const tools = await listTools()
  const tool = tools.find((candidate) => candidate.name === name)
  const result = (await active.callTool({
    name,
    arguments: (input ?? {}) as Record<string, unknown>,
    _meta: {
      'openai/locale': config.locale,
      'openai/userAgent': 'chatgpt-app-emulator',
      'openai/subject': 'emulator-user',
      'openai/session': sessionId,
    },
  })) as CallToolResult
  const record: CallRecord = { id, toolName: name, input, result, resourceUri: tool?.resourceUri }
  calls.set(id, record)
  return record
}

export const getCall = (id: string) => calls.get(id)

export async function restoreCall(id: string, toolName: string, input: unknown, result: CallToolResult) {
  if (calls.has(id)) return
  const tool = (await listTools()).find((candidate) => candidate.name === toolName)
  calls.set(id, { id, toolName, input, result, resourceUri: tool?.resourceUri })
}

export function setWidgetState(id: string, state: unknown) {
  const record = calls.get(id)
  if (record) record.widgetState = state
}

export function modelVisibleResult(result: CallToolResult) {
  return {
    ...(result.isError ? { isError: true } : {}),
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    content: result.content,
  }
}
