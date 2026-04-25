/**
 * DinnerMoney — LunchMoney CORS proxy
 * Deploy as a Cloudflare Worker (free tier: 100k req/day).
 * This worker only forwards requests to dev.lunchmoney.app.
 * It adds CORS headers so the browser SPA can call it directly.
 * No data is logged or stored.
 */

const TARGET = 'https://dev.lunchmoney.app'

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    const url = new URL(request.url)
    const targetUrl = TARGET + url.pathname + url.search

    const proxied = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    })

    const response = await fetch(proxied)

    // Copy upstream headers, stripping any CORS headers LunchMoney sends.
    // LunchMoney returns Access-Control-Allow-Credentials: true which is
    // incompatible with Access-Control-Allow-Origin: * and causes browsers
    // to reject the response. We replace all CORS headers with our own.
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
