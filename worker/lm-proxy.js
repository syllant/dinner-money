/**
 * DinnerMoney — LunchMoney, Plaid & SnapTrade CORS proxy
 * Deploy as a Cloudflare Worker (free tier: 100k req/day).
 *
 * Routes:
 *   GET  /plaid/ping          → health check (confirms secrets are set, never reveals them)
 *   POST /plaid/*             → https://<PLAID_ENV>.plaid.com/* (injects PLAID_CLIENT_ID + PLAID_SECRET)
 *   GET  /snaptrade/ping      → health check + upstream status check
 *   *    /snaptrade/*         → https://api.snaptrade.com/api/v1/* (signed server-side)
 *   GET  /tiingo/*            → https://api.tiingo.com/*
 *   GET  /fred/*              → https://api.stlouisfed.org/fred/*
 *   GET  /external?url=...    → allowlisted public market-data APIs
 *   *    /*                   → https://dev.lunchmoney.app/*
 *
 * Required Worker secrets  (wrangler secret put <NAME>):
 *   PLAID_CLIENT_ID   — from Plaid dashboard → Team → Keys
 *   PLAID_SECRET      — environment-specific secret (sandbox / development / production)
 *   SNAPTRADE_CLIENT_ID
 *   SNAPTRADE_CONSUMER_KEY
 *
 * Optional Worker variable (wrangler.toml [vars] or secret):
 *   PLAID_ENV         — "sandbox" | "development" | "production"  (default: "production")
 *
 * No data is logged or stored.
 */

const LM_TARGET = 'https://dev.lunchmoney.app'
const SNAPTRADE_TARGET = 'https://api.snaptrade.com/api/v1'

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

    // --- SNAPTRADE ROUTING ---
    if (url.pathname.startsWith('/snaptrade/')) {
      const credentials = snapTradeCredentials(request, env)

      if (url.pathname === '/snaptrade/ping') {
        if (!credentials.clientId || !credentials.consumerKey) {
          return jsonResponse({
            ok: false,
            client_id_set: !!credentials.clientId,
            consumer_key_set: !!credentials.consumerKey,
            message: 'SNAPTRADE_CLIENT_ID or SNAPTRADE_CONSUMER_KEY is not configured. Add Worker secrets, or test with local Settings values.',
          }, 200)
        }

        const upstream = await signedSnapTradeFetch('/', request, url, credentials)
        const upstreamBody = await upstream.json().catch(() => null)
        return jsonResponse({
          ok: upstream.ok,
          client_id_set: true,
          consumer_key_set: true,
          upstream: upstreamBody,
          message: upstream.ok ? undefined : `SnapTrade returned ${upstream.status}`,
        }, upstream.ok ? 200 : upstream.status)
      }

      if (!credentials.clientId || !credentials.consumerKey) {
        return jsonResponse({
          error: 'SNAPTRADE_CREDENTIALS_NOT_SET',
          message: 'SNAPTRADE_CLIENT_ID or SNAPTRADE_CONSUMER_KEY is not configured on this Cloudflare Worker.',
        }, 500)
      }

      const snapPath = url.pathname.replace('/snaptrade', '') || '/'
      const response = await signedSnapTradeFetch(snapPath, request, url, credentials)
      return withCors(response)
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

function snapTradeCredentials(request, env) {
  const clientId = request.headers.get('X-SnapTrade-Client-Id')?.trim()
    || (typeof env.SNAPTRADE_CLIENT_ID === 'string' ? env.SNAPTRADE_CLIENT_ID.trim() : '')
  const consumerKey = request.headers.get('X-SnapTrade-Consumer-Key')?.trim()
    || (typeof env.SNAPTRADE_CONSUMER_KEY === 'string' ? env.SNAPTRADE_CONSUMER_KEY.trim() : '')
  return { clientId, consumerKey }
}

async function signedSnapTradeFetch(snapPath, request, requestUrl, credentials) {
  const method = request.method.toUpperCase()
  const content = await requestJson(request)
  const targetUrl = new URL(SNAPTRADE_TARGET + snapPath)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const queryPairs = [
    ['clientId', credentials.clientId],
    ['timestamp', timestamp],
    ...[...requestUrl.searchParams.entries()]
      .filter(([key]) => key !== 'clientId' && key !== 'timestamp' && key !== 'signature'),
  ]
  const unsignedQuery = queryPairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
  const requestPath = `/api/v1${snapPath}`
  const signature = await snapTradeSignature(credentials.consumerKey, {
    content: Object.keys(content).length === 0 ? null : content,
    path: requestPath,
    query: unsignedQuery,
  })
  targetUrl.search = unsignedQuery

  const headers = new Headers()
  headers.set('Accept', 'application/json')
  headers.set('Signature', signature)
  if (!['GET', 'HEAD'].includes(method)) headers.set('Content-Type', 'application/json')

  return fetch(new Request(targetUrl.toString(), {
    method,
    headers,
    body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(content),
  }))
}

async function requestJson(request) {
  if (['GET', 'HEAD'].includes(request.method.toUpperCase())) return {}
  try {
    return await request.json()
  } catch (_) {
    return {}
  }
}

async function snapTradeSignature(consumerKey, signatureObject) {
  const encodedKey = encodeURI(consumerKey)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(encodedKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigContent = jsonStringifyOrdered(signatureObject)
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sigContent))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

function jsonStringifyOrdered(obj) {
  const allKeys = []
  const seen = {}
  JSON.stringify(obj, (key, value) => {
    if (!(key in seen)) {
      allKeys.push(key)
      seen[key] = null
    }
    return value
  })
  allKeys.sort()
  return JSON.stringify(obj, allKeys)
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-SnapTrade-Client-Id, X-SnapTrade-Consumer-Key',
    'Access-Control-Max-Age': '86400',
  }
}
