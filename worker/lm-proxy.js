/**
 * DinnerMoney — LunchMoney & Plaid CORS proxy
 * Deploy as a Cloudflare Worker (free tier: 100k req/day).
 *
 * Routes:
 * - /plaid/* -> https://development.plaid.com/* (injects PLAID_CLIENT_ID and PLAID_SECRET)
 * - /* -> https://dev.lunchmoney.app/*
 *
 * No data is logged or stored.
 */

const LM_TARGET = 'https://dev.lunchmoney.app'
const PLAID_TARGET = 'https://production.plaid.com'

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    const url = new URL(request.url)

    // --- PLAID ROUTING ---
    if (url.pathname.startsWith('/plaid/')) {
      const plaidPath = url.pathname.replace('/plaid', '')
      const targetUrl = PLAID_TARGET + plaidPath

      // We must inject the client_id and secret into the JSON body for Plaid
      let bodyData = {}
      if (request.method === 'POST') {
        try {
          bodyData = await request.clone().json()
        } catch (e) {
          // ignore
        }
      }

      bodyData.client_id = typeof env.PLAID_CLIENT_ID === 'string' ? env.PLAID_CLIENT_ID.trim() : env.PLAID_CLIENT_ID
      bodyData.secret = typeof env.PLAID_SECRET === 'string' ? env.PLAID_SECRET.trim() : env.PLAID_SECRET

      // Strip all browser headers (Origin, Referer, Sec-*) so Plaid treats it as a server request
      const newHeaders = new Headers()
      newHeaders.set('Content-Type', 'application/json')

      const proxied = new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.method === 'POST' ? JSON.stringify(bodyData) : undefined,
      })

      const response = await fetch(proxied)
      return new Response(response.body, {
        status: response.status,
        headers: corsHeaders(),
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
