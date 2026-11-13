import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { chatgpt } from 'eve/models/openai'
import { config } from './config.js'

type ScriptedPart = Record<string, unknown>

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

const say = (text: string): ScriptedPart[] => [
  { type: 'text-start', id: 'text' },
  { type: 'text-delta', id: 'text', delta: text },
  { type: 'text-end', id: 'text' },
  { type: 'finish', usage, finishReason: { unified: 'stop', raw: undefined } },
]

function script(last: { role: string; content: unknown } | undefined): ScriptedPart[] {
  if (last?.role === 'tool') return say('Tool call finished. Scripted mode does not interpret results.')
  const text = Array.isArray(last?.content)
    ? last.content.flatMap((part: { type: string; text?: string }) => (part.type === 'text' ? [part.text ?? ''] : [])).join('')
    : ''
  const command = text.trim().match(/^\/(\S+)\s*([\s\S]*)$/)
  if (!command) return say('Scripted mode: type /tool_name {"arg": 1} to call a tool.')
  return [
    { type: 'tool-call', toolCallId: `call_${Date.now()}`, toolName: command[1], input: command[2].trim() || '{}' },
    { type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: undefined } },
  ]
}

function scripted() {
  return new MockLanguageModelV4({
    provider: 'emulator',
    modelId: 'scripted',
    doStream: async ({ prompt }) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          for (const part of script(prompt.at(-1))) controller.enqueue(part as never)
          controller.close()
        },
      }),
    }),
  })
}

export type ModelOption = { key: string; name: string; tag: string }

function listOptions(): ModelOption[] {
  if (config.provider === 'scripted') return [{ key: 'scripted', name: 'Scripted', tag: 'No model' }]
  if (config.provider === 'openai') {
    const key = config.modelId ?? 'gpt-6.1-sol'
    return [{ key, name: key, tag: 'OpenAI API' }]
  }
  const eveDefault = (chatgpt() as { modelId: string }).modelId
  const keys = [...new Set([config.modelId ?? eveDefault, eveDefault, 'gpt-6-sol', 'gpt-6-astra'])]
  return keys.map((key, index) => ({ key, name: key, tag: index === 0 ? 'Default' : '' }))
}

export const modelOptions = listOptions()
export const defaultModel = modelOptions[0].key

const models = new Map<string, LanguageModel>()

function create(key: string): LanguageModel {
  if (config.provider === 'scripted') return scripted()
  if (config.provider === 'openai') return createOpenAI()(key)
  return chatgpt(key)
}

export function modelFor(requested?: string) {
  const key = modelOptions.some((option) => option.key === requested) ? requested! : defaultModel
  if (!models.has(key)) models.set(key, create(key))
  return models.get(key)!
}
