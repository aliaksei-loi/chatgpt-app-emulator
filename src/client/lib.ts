import type { AppTool } from './api'

export const pretty = (value: unknown) => JSON.stringify(value, null, 2)

export function defaultArgs(tool: AppTool) {
  const properties = tool.inputSchema.properties ?? {}
  return Object.fromEntries(
    (tool.inputSchema.required ?? []).map((key) => {
      const property = properties[key] ?? {}
      const lowest = Math.max(0, property.minimum ?? 0)
      const fallback = { number: lowest, integer: lowest, boolean: false, array: [], object: {} }
      return [key, fallback[property.type as keyof typeof fallback] ?? '']
    }),
  )
}

export function parseToolCommand(text: string, tools: AppTool[]) {
  const command = text.match(/^\/([\w-]+)\s*([\s\S]*)$/)
  const tool = command && tools.find((candidate) => candidate.name === command[1])
  if (!command || !tool) return null
  const rawArgs = command[2].trim()
  return { tool, args: rawArgs ? (JSON.parse(rawArgs) as unknown) : defaultArgs(tool) }
}
