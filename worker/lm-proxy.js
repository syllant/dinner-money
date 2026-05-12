/**
 * DinnerMoney — LunchMoney, Plaid & IBKR Flex CORS proxy
 * Deploy as a Cloudflare Worker (free tier: 100k req/day).
 *
 * Routes:
 *   GET  /plaid/ping          → health check (confirms secrets are set, never reveals them)
 *   POST /plaid/*             → https://<PLAID_ENV>.plaid.com/* (injects PLAID_CLIENT_ID + PLAID_SECRET)
 *   GET  /ibkr-flex/ping      → health check
 *   POST /ibkr-flex/query     → IBKR Flex Web Service request + statement polling
 *   GET  /tiingo/*            → https://api.tiingo.com/*
 *   GET  /fred/*              → https://api.stlouisfed.org/fred/*
 *   GET  /external?url=...    → allowlisted public market-data APIs
 *   *    /*                   → https://dev.lunchmoney.app/*
 *
 * Required Worker secrets  (wrangler secret put <NAME>):
 *   PLAID_CLIENT_ID   — from Plaid dashboard → Team → Keys
 *   PLAID_SECRET      — environment-specific secret (sandbox / development / production)
 * Optional Worker variable (wrangler.toml [vars] or secret):
 *   PLAID_ENV         — "sandbox" | "development" | "production"  (default: "production")
 *
 * No data is logged or stored.
 */

const LM_TARGET = 'https://dev.lunchmoney.app'
const IBKR_FLEX_BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService'

function plaidBaseUrl(env) {
  const e = (env.PLAID_ENV ?? 'production').toLowerCase().trim()
  if (e === 'sandbox') return 'https://sandbox.plaid.com'
  if (e === 'development') return 'https://development.plaid.com'
  return 'https://production.plaid.com'
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    const url = new URL(request.url)

    // --- PLAID ROUTING ---
    if (url.pathname.startsWith('/plaid/')) {
      // Optional shared-secret gate: enforced when WORKER_SECRET env var is set.
      // Set via: wrangler secret put WORKER_SECRET
      const workerSecret = typeof env.WORKER_SECRET === 'string' ? env.WORKER_SECRET.trim() : ''
      if (workerSecret && request.headers.get('X-Worker-Secret') !== workerSecret) {
        return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
          status: 401,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        })
      }

      const clientId = typeof env.PLAID_CLIENT_ID === 'string' ? env.PLAID_CLIENT_ID.trim() : ''
      const secret   = typeof env.PLAID_SECRET   === 'string' ? env.PLAID_SECRET.trim()   : ''

      // Diagnostic endpoint — confirms secrets are present without revealing values
      if (url.pathname === '/plaid/ping') {
        return new Response(JSON.stringify({
          ok: !!(clientId && secret),
          client_id_set: !!clientId,
          secret_set: !!secret,
          plaid_env: env.PLAID_ENV ?? 'production',
          plaid_url: plaidBaseUrl(env),
        }), { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
      }

      // Guard — return a clear error instead of letting Plaid see empty credentials
      if (!clientId || !secret) {
        return new Response(JSON.stringify({
          error: 'PLAID_CREDENTIALS_NOT_SET',
          message: 'PLAID_CLIENT_ID or PLAID_SECRET is not configured on this Cloudflare Worker. Run: wrangler secret put PLAID_CLIENT_ID && wrangler secret put PLAID_SECRET',
        }), { status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
      }

      const plaidPath = url.pathname.replace('/plaid', '')
      const targetUrl = plaidBaseUrl(env) + plaidPath

      // Inject credentials into the JSON body
      let bodyData = {}
      if (request.method === 'POST') {
        try {
          bodyData = await request.json()
        } catch (_) {
          // non-JSON body — leave empty
        }
      }
      bodyData.client_id = clientId
      bodyData.secret = secret

      const bodyJson = JSON.stringify(bodyData)

      // Strip all browser-origin headers so Plaid treats this as a server request
      const newHeaders = new Headers()
      newHeaders.set('Content-Type', 'application/json')

      const proxied = new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.method === 'POST' ? bodyJson : undefined,
      })

      const response = await fetch(proxied)
      // Forward Plaid's body intact so error messages reach the client
      return new Response(response.body, {
        status: response.status,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      })
    }

    // --- IBKR FLEX ROUTING ---
    if (url.pathname.startsWith('/ibkr-flex/')) {
      if (url.pathname === '/ibkr-flex/ping') {
        return jsonResponse({ ok: true, reachable: true, message: 'IBKR Flex proxy reachable' }, 200)
      }
      if (url.pathname === '/ibkr-flex/query' && request.method === 'POST') {
        const body = await requestJson(request)
        const token = typeof body.token === 'string' ? body.token.trim() : ''
        const queryId = typeof body.queryId === 'string' ? body.queryId.trim() : ''
        if (!token || !queryId) {
          return jsonResponse({ error: 'IBKR_FLEX_CREDENTIALS_REQUIRED', message: 'IBKR Flex token and Query ID are required.' }, 400)
        }
        try {
          const xml = await fetchIbkrFlexStatement(token, queryId)
          return new Response(xml, {
            status: 200,
            headers: { ...corsHeaders(), 'Content-Type': 'application/xml; charset=utf-8' },
          })
        } catch (err) {
          return jsonResponse({
            error: 'IBKR_FLEX_ERROR',
            message: err instanceof Error ? err.message : String(err),
          }, 502)
        }
      }
      return jsonResponse({ error: 'IBKR_FLEX_ROUTE_NOT_FOUND' }, 404)
    }

    // --- TIINGO ROUTING ---
    if (url.pathname.startsWith('/tiingo/')) {
      const targetUrl = 'https://api.tiingo.com/' + url.pathname.replace('/tiingo/', '') + url.search
      return proxyGet(targetUrl)
    }

    // --- FRED ROUTING ---
    if (url.pathname.startsWith('/fred/')) {
      const targetUrl = 'https://api.stlouisfed.org/fred/' + url.pathname.replace('/fred/', '') + url.search
      return proxyGet(targetUrl)
    }

    // --- PUBLIC MARKET-DATA ROUTING ---
    if (url.pathname === '/external') {
      const targetUrl = url.searchParams.get('url') || ''
      if (!isAllowedExternalUrl(targetUrl)) {
        return jsonResponse({ error: 'URL_NOT_ALLOWED' }, 400)
      }
      return proxyGet(targetUrl)
    }

    // --- LUNCHMONEY ROUTING ---
    const targetUrl = LM_TARGET + url.pathname + url.search

    const proxied = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    })

    const response = await fetch(proxied)

    // Copy upstream headers, stripping any CORS headers LunchMoney sends.
    const headers = new Headers()
    for (const [key, value] of response.headers) {
      if (!key.toLowerCase().startsWith('access-control-')) {
        headers.set(key, value)
      }
    }
    for (const [key, value] of Object.entries(corsHeaders())) {
      headers.set(key, value)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}

async function requestJson(request) {
  if (['GET', 'HEAD'].includes(request.method.toUpperCase())) return {}
  try {
    return await request.json()
  } catch (_) {
    return {}
  }
}

async function fetchIbkrFlexStatement(token, queryId) {
  const requestUrl = new URL(`${IBKR_FLEX_BASE}/SendRequest`)
  requestUrl.searchParams.set('t', token)
  requestUrl.searchParams.set('q', queryId)
  requestUrl.searchParams.set('v', '3')

  const requestXml = await fetchText(requestUrl.toString())
  const requestStatus = xmlValue(requestXml, 'Status')
  if (requestStatus && requestStatus.toLowerCase() !== 'success') {
    throw new Error(xmlValue(requestXml, 'ErrorMessage') || xmlValue(requestXml, 'Error') || `IBKR Flex request failed: ${requestStatus}`)
  }
  const referenceCode = xmlValue(requestXml, 'ReferenceCode')
  if (!referenceCode) throw new Error('IBKR Flex did not return a reference code.')

  const statementUrl = new URL(`${IBKR_FLEX_BASE}/GetStatement`)
  statementUrl.searchParams.set('t', token)
  statementUrl.searchParams.set('q', referenceCode)
  statementUrl.searchParams.set('v', '3')

  let lastXml = ''
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) await sleep(attempt < 4 ? 1500 : 3000)
    lastXml = await fetchText(statementUrl.toString())
    const status = xmlValue(lastXml, 'Status')
    if (!status || status.toLowerCase() === 'success') return lastXml
    const code = xmlValue(lastXml, 'ErrorCode')
    const message = xmlValue(lastXml, 'ErrorMessage') || xmlValue(lastXml, 'Error')
    if (code === '1019' || /statement.*not.*ready|temporarily unavailable|pending/i.test(message ?? status)) continue
    throw new Error(message || `IBKR Flex statement failed: ${status}`)
  }
  throw new Error(xmlValue(lastXml, 'ErrorMessage') || 'IBKR Flex statement was not ready after polling.')
}

async function fetchText(targetUrl) {
  const response = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/xml,text/xml,*/*',
      'User-Agent': 'DinnerMoney/1.0 (+https://github.com)',
    },
  })
  const text = await response.text()
  if (!response.ok) {
    const hint = response.status === 403
      ? ' IBKR requires a User-Agent header; redeploy the updated Worker if this persists.'
      : ''
    throw new Error(`IBKR Flex returned ${response.status}: ${text.slice(0, 200)}${hint}`)
  }
  return text
}

function xmlValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'))
  return match ? decodeXml(match[1].trim()) : ''
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
}

function withCors(response) {
  const headers = new Headers()
  for (const [key, value] of response.headers) {
    if (!key.toLowerCase().startsWith('access-control-')) {
      headers.set(key, value)
    }
  }
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function proxyGet(targetUrl) {
  const accept = targetUrl.includes('tradingeconomics.com')
    ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    : 'application/json,text/csv,text/plain,*/*'
  const response = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      Accept: accept,
      'User-Agent': 'Mozilla/5.0 (compatible; DinnerMoney/1.0; +https://github.com)',
    },
  })
  const headers = new Headers()
  for (const [key, value] of response.headers) {
    if (!key.toLowerCase().startsWith('access-control-')) {
      headers.set(key, value)
    }
  }
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isAllowedExternalUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl)
    const allowedHosts = new Set([
      'tradingeconomics.com',
      'data-api.ecb.europa.eu',
      'query1.finance.yahoo.com',
      'api.elections.kalshi.com',
      'gamma-api.polymarket.com',
    ])
    return parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname)
  } catch (_) {
    return false
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}
