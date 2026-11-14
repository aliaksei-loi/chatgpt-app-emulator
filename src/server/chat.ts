import { convertToModelMessages, dynamicTool, jsonSchema, stepCountIs, streamText, type UIMessage } from 'ai'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { modelVisibleResult, runTool, snapshot } from './mcp.js'
import { modelFor } from './model.js'

type WidgetContext = { toolName: string; text: string }

function currentDate() {
  const now = new Date()
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return `Current date: ${now.toLocaleDateString('sv-SE')} (${weekday}). User time zone: ${timeZone}.`
}

function systemPrompt(appName: string, instructions: string | undefined, context: WidgetContext[]) {
  return [
    'You are ChatGPT, a large language model trained by OpenAI.',
    currentDate(),
    `The user has connected the app "${appName}". Use its tools when they help answer the request.`,
    'Some tools render an interactive widget that the user sees directly. After such a tool call, do not repeat the widget content, add only a short remark.',
    instructions ? `Instructions from the app:\n${instructions}` : '',
    context.length
      ? `Current context shared by the app's widgets, not visible to the user:\n${context.map((entry) => `[${entry.toolName}] ${entry.text}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export async function chat(messages: UIMessage[], modelKey?: string, context: WidgetContext[] = []) {
  const state = await snapshot()
  const tools = Object.fromEntries(
    state.tools
      .filter((tool) => tool.modelVisible)
      .map((tool) => [
        tool.name,
        dynamicTool({
          description: tool.description,
          inputSchema: jsonSchema(tool.inputSchema as never),
          execute: async (input, { toolCallId }) => (await runTool(tool.name, input, toolCallId)).result,
          toModelOutput: ({ output }) => ({
            type: 'json',
            value: modelVisibleResult(output as CallToolResult) as never,
          }),
        }),
      ]),
  )
  const result = streamText({
    model: modelFor(modelKey),
    system: systemPrompt(state.connected ? (state.serverInfo?.name ?? 'app') : 'app', state.connected ? state.instructions : undefined, context),
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    stopWhen: stepCountIs(12),
  })
  return result.toUIMessageStreamResponse()
}
