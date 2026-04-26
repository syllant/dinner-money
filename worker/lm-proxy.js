/**
 * DinnerMoney — LunchMoney & Plaid CORS proxy
 * Deploy as a Cloudflare Worker (free tier: 100k req/day).
 *
 * Routes:
 *   GET  /plaid/ping          → health check (confirms secrets are set, never reveals them)
 *   POST /plaid/*             → https://<PLAID_ENV>.plaid.com/* (injects PLAID_CLIENT_ID + PLAID_SECRET)
 *   *    /*                   → https://dev.lunchmoney.app/*
 *
 * Required Worker secrets  (wrangler secret put <NAME>):
 *   PLAID_CLIENT_ID   — from Plaid dashboard → Team → Keys
 *   PLAID_SECRET      — environment-specific secret (sandbox / development / production)
 *
 * Optional Worker variable (wrangler.toml [vars] or secret):
 *   PLAID_ENV         — "sandbox" | "development" | "production"  (default: "production")
 *
 * No data is logged or stored.
 */

const LM_TARGET = 'https://dev.lunchmoney.app'

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

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}
