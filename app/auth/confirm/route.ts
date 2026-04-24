import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseRouteHandlerClient } from '@/src/lib/supabase/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type') as EmailOtpType | null
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') || '/dashboard'
  const safeNext = next.startsWith('/') ? next : '/dashboard'
  const redirectUrl = new URL(safeNext, requestUrl.origin)
  const responseCookies: Array<{ name: string; value: string; options?: Parameters<NextResponse['cookies']['set']>[2] }> = []
  const supabase = await createSupabaseRouteHandlerClient((cookiesToSet) => {
    responseCookies.push(...cookiesToSet)
  })

  function redirectWithCookies(url: URL | string) {
    const response = NextResponse.redirect(url, 303)

    responseCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options)
    })

    return response
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return redirectWithCookies(redirectUrl.toString())
    }
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })

    if (!error) {
      return redirectWithCookies(redirectUrl.toString())
    }
  }

  const callbackUrl = new URL('/auth/callback', requestUrl.origin)
  callbackUrl.searchParams.set('next', safeNext)

  const fallbackHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Finishing your Manoa login…</title>
    <style>
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f4f7ff;
        color: #16213a;
      }
      main {
        width: min(640px, calc(100% - 32px));
        margin: 24px auto 48px;
      }
      .card {
        border: 1px solid #d8dff0;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 20px 48px rgba(22, 33, 58, 0.08);
        padding: 24px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 2.3rem;
        line-height: 1.05;
      }
      p {
        margin: 0;
        color: #5d6b85;
        font-size: 1rem;
        line-height: 1.7;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>Finishing your login.</h1>
        <p id="status">Checking your secure Manoa link…</p>
      </div>
    </main>
    <script>
      (function () {
        var nextUrl = ${JSON.stringify(callbackUrl.toString())};
        var hash = window.location.hash || '';
        if (hash) {
          document.getElementById('status').textContent = 'Signing you in...';
          window.location.replace(nextUrl + hash);
          return;
        }
        window.location.replace('/login?login=error');
      })();
    </script>
  </body>
</html>`

  const response = new NextResponse(fallbackHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })

  responseCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })

  return response
}
