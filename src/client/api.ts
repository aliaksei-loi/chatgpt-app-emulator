export type ToolResult = {
  content?: unknown[]
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
  isError?: boolean
}

export type AppTool = {
  name: string
  title?: string
  description?: string
  inputSchema: { properties?: Record<string, { type?: string; minimum?: number }>; required?: string[] }
  annotations?: { readOnlyHint?: boolean }
  meta: Record<string, unknown>
  resourceUri?: string
  modelVisible: boolean
  appVisible: boolean
}

export type WidgetInfo = { hash?: string; mimeType?: string; meta?: Record<string, unknown>; cspDeclared?: boolean; error?: string }

export type ExampleInfo = { id: string; title: string; description: string; runtime: 'node' | 'python' | 'remote'; prompts: string[] }

export type EmulatorState = {
  connected: boolean
  serverUrl: string
  serverInfo?: { name: string; version: string }
  error?: string
  tools: AppTool[]
  widgets: Record<string, WidgetInfo>
  sandboxOrigin: string
  examples: {
    list: ExampleInfo[]
    active: { id: string | null; status: 'idle' | 'preparing' | 'starting' | 'running' | 'failed'; message?: string }
  }
  provider: string
  model: string
  models: { key: string; name: string; tag: string }[]
  locale: string
}

export type LogEntry = {
  id: number
  time: string
  callId: string
  direction: 'from-widget' | 'to-widget'
  channel: 'mcp-apps' | 'window.openai'
  method: string
  payload: unknown
}

const json = { 'Content-Type': 'application/json' }

export const fetchState = (): Promise<EmulatorState> => fetch('/api/state').then((response) => response.json())

export const startExample = (id: string) =>
  fetch('/api/examples/start', { method: 'POST', headers: json, body: JSON.stringify({ id }) })

export async function connectServer(url: string) {
  const response = await fetch('/api/server', { method: 'POST', headers: json, body: JSON.stringify({ url }) })
  if (!response.ok) throw new Error((await response.json()).error)
}

export async function callTool(name: string, args: unknown): Promise<{ callId: string; result: ToolResult }> {
  const response = await fetch('/api/tools/call', { method: 'POST', headers: json, body: JSON.stringify({ name, args }) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error)
  return data
}

export const restoreCall = (callId: string, toolName: string, input: unknown, result: ToolResult | undefined) =>
  fetch(`/api/calls/${callId}`, { method: 'PUT', headers: json, body: JSON.stringify({ toolName, input, result }) })

export const saveWidgetState = (callId: string, state: unknown) =>
  fetch(`/api/calls/${callId}/widget-state`, { method: 'POST', headers: json, body: JSON.stringify({ state }) })

export const readResource = (uri: string) =>
  fetch(`/api/resources/read?uri=${encodeURIComponent(uri)}`).then((response) => response.json())
