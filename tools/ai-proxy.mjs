#!/usr/bin/env node
/**
 * Local proxy for the Panel36 assembly assistant.
 *
 * The browser app never talks to an AI provider directly. This process holds the API
 * key, listens on the loopback interface only, and forwards a plain {system, context,
 * question} envelope. It knows nothing about panels: every decision about what leaves
 * the browser lives in the app, in src/domain/assistantContext.ts.
 *
 * Run:   npm run ai
 * Setup: cp tools/ai-proxy.env.example tools/ai-proxy.env  and fill in the key.
 * The env file is git-ignored. Request bodies are never logged.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const HOST = '127.0.0.1'
// Sliding-window limit on /chat: the proxy holds a paid API key, so any local
// runaway loop must hit a wall instead of burning the quota.
const CHAT_RATE_LIMIT = Number(process.env.AI_PROXY_RATE_LIMIT) || 10
const CHAT_RATE_WINDOW_MS = Number(process.env.AI_PROXY_RATE_WINDOW_MS) || 60_000
const chatHits = []
const chatAllowed = (now) => {
  while (chatHits.length > 0 && now - chatHits[0] > CHAT_RATE_WINDOW_MS) chatHits.shift()
  if (chatHits.length >= CHAT_RATE_LIMIT) return false
  chatHits.push(now)
  return true
}

/**
 * The port is named for the build as well: the browser half and the production CSP both read
 * VITE_AI_PROXY_PORT, so moving the proxy moves all three at once. A variable only the proxy knew
 * about used to break the assistant silently — the request left for the old port and the panel
 * reported "прокси не отвечает".
 */
const DEFAULT_PORT = 8787
const MAX_BODY_BYTES = 256 * 1024
const MAX_TOKENS = 2000
const UPSTREAM_TIMEOUT_MS = 120_000

const here = dirname(fileURLToPath(import.meta.url))
const ENV_FILE = join(here, 'ai-proxy.env')

const PROVIDERS = {
  anthropic: {
    defaultBaseUrl: 'https://api.anthropic.com',
    build: ({ apiKey, model, system, question }) => ({
      url: `${trimSlash(model.baseUrl)}/v1/messages`,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: { model: model.id, max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content: question }] },
    }),
    read: (data) => {
      const text = Array.isArray(data?.content)
        ? data.content.filter((item) => item?.type === 'text').map((item) => item.text).join('')
        : ''
      return text
    },
  },
  openai: {
    defaultBaseUrl: 'https://api.openai.com',
    build: ({ apiKey, model, system, question }) => ({
      url: `${trimSlash(model.baseUrl)}/v1/chat/completions`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: { model: model.id, max_tokens: MAX_TOKENS, messages: [{ role: 'system', content: system }, { role: 'user', content: question }] },
    }),
    read: (data) => (typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : ''),
  },
}

const trimSlash = (value) => String(value).replace(/\/+$/, '')

const parseEnvFile = (text) => {
  const values = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 1) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[key] = value
  }
  return values
}

const loadConfig = async () => {
  let fileValues = {}
  try {
    fileValues = parseEnvFile(await readFile(ENV_FILE, 'utf8'))
  } catch {
    // No env file: the process still starts and reports a missing key on /health.
  }
  const pick = (key) => process.env[key] ?? fileValues[key] ?? ''
  const providerId = (pick('AI_PROVIDER') || 'anthropic').toLowerCase()
  const provider = PROVIDERS[providerId]
  const apiKey = pick('AI_API_KEY')
  // The provider's own endpoint is the fallback, not an optional extra: without it an unset
  // AI_BASE_URL produced a relative URL and every request failed with "Failed to parse URL".
  const defaultBaseUrl = provider?.defaultBaseUrl ?? ''
  const baseUrl = pick('AI_BASE_URL') || defaultBaseUrl
  return {
    providerId,
    provider,
    apiKey,
    customBaseUrl: Boolean(baseUrl && baseUrl !== defaultBaseUrl),
    model: { id: pick('AI_MODEL') || (providerId === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o-mini'), baseUrl },
  }
}

const sendJson = (response, status, payload) => {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

const allowedOrigin = (origin) => {
  if (!origin) return true
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
}

const readBody = (request) => new Promise((resolveBody, rejectBody) => {
  const chunks = []
  let size = 0
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      rejectBody(new Error('payload_too_large'))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
  request.on('error', rejectBody)
})

const main = async () => {
  const config = await loadConfig()
  if (!config.provider) {
    console.error(`[ai] Неизвестный AI_PROVIDER: ${config.providerId}. Доступные: ${Object.keys(PROVIDERS).join(', ')}`)
    process.exit(1)
  }

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin
    if (!allowedOrigin(origin)) {
      sendJson(response, 403, { error: 'origin_not_allowed' })
      return
    }
    const headers = { 'access-control-allow-origin': origin ?? '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers)
      response.end()
      return
    }
    Object.entries(headers).forEach(([key, value]) => response.setHeader(key, value))

    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, {
        ok: true,
        configured: Boolean(config.apiKey),
        provider: config.providerId,
        model: config.model.id,
      })
      return
    }

    if (request.method === 'POST' && request.url === '/chat') {
      if (!chatAllowed(Date.now())) {
        sendJson(response, 429, { error: 'rate_limited', message: `Лимит ${CHAT_RATE_LIMIT} запросов за ${CHAT_RATE_WINDOW_MS / 1000} с исчерпан. Подождите немного.` })
        return
      }
      if (!config.apiKey) {
        sendJson(response, 503, { error: 'no_api_key', message: 'Прокси запущен, но ключ не задан. Заполните tools/ai-proxy.env и перезапустите npm run ai.' })
        return
      }
      let payload
      try {
        payload = JSON.parse(await readBody(request))
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error && error.message === 'payload_too_large' ? 'payload_too_large' : 'bad_json' })
        return
      }
      const system = typeof payload?.system === 'string' ? payload.system : ''
      const question = typeof payload?.question === 'string' ? payload.question : ''
      const context = typeof payload?.context === 'string' ? payload.context : ''
      if (!question.trim()) {
        sendJson(response, 400, { error: 'empty_question' })
        return
      }
      const userText = context ? `${context}\n\n---\n\nВопрос пользователя: ${question}` : question
      const upstream = config.provider.build({ apiKey: config.apiKey, model: config.model, system, question: userText })
      try {
        const result = await fetch(upstream.url, {
          method: 'POST',
          headers: upstream.headers,
          body: JSON.stringify(upstream.body),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        })
        const raw = await result.text()
        if (!result.ok) {
          console.warn(`[ai] провайдер ответил ${result.status}`)
          sendJson(response, 502, { error: 'provider_error', status: result.status, message: `Провайдер вернул ${result.status}. Проверьте ключ, модель и лимиты.` })
          return
        }
        const text = config.provider.read(JSON.parse(raw))
        if (!text.trim()) {
          sendJson(response, 502, { error: 'empty_answer' })
          return
        }
        sendJson(response, 200, { text })
      } catch (error) {
        const timedOut = error instanceof Error && /timeout|abort/i.test(error.message)
        console.warn(`[ai] запрос не удался: ${timedOut ? 'таймаут' : error instanceof Error ? error.message : 'неизвестная ошибка'}`)
        sendJson(response, timedOut ? 504 : 502, { error: timedOut ? 'timeout' : 'network_error' })
      }
      return
    }

    sendJson(response, 404, { error: 'not_found' })
  })

  const port = Number(process.env.VITE_AI_PROXY_PORT) || DEFAULT_PORT
  server.listen(port, HOST, () => {
    console.log(`[ai] Прокси слушает http://${HOST}:${port} (провайдер: ${config.providerId}, модель: ${config.model.id})`)
    if (!config.apiKey) console.log('[ai] ВНИМАНИЕ: ключ не найден. Скопируйте tools/ai-proxy.env.example в tools/ai-proxy.env и заполните AI_API_KEY.')
    // The key travels to whatever host the base URL names, so a custom endpoint is worth saying out loud.
    if (config.customBaseUrl) console.warn(`[ai] ВНИМАНИЕ: AI_BASE_URL = ${config.model.baseUrl} — ключ будет отправлен туда, а не на официальный адрес провайдера. Убедитесь, что это доверенный адрес.`)
    console.log('[ai] Содержимое запросов не выводится в журнал.')
  })
}

main().catch((error) => {
  console.error('[ai] прокси не запустился:', error instanceof Error ? error.message : error)
  process.exit(1)
})
