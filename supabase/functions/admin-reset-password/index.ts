import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const authorization = request.headers.get('Authorization')
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
      return jsonResponse({ error: 'Missing server configuration or authorization' }, 401)
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData.user) return jsonResponse({ error: '登录状态无效，请重新登录' }, 401)

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: callerProfile, error: profileError } = await serviceClient
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (profileError) throw profileError
    if (callerProfile?.role !== 'admin') return jsonResponse({ error: '仅管理员可以重置成员密码' }, 403)

    const body = await request.json().catch(() => ({})) as { user_id?: string; password?: string }
    const userId = String(body.user_id || '').trim()
    const password = String(body.password || '')
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return jsonResponse({ error: '成员 ID 无效' }, 400)
    if (password.length < 8 || password.length > 128) return jsonResponse({ error: '密码长度必须为 8 到 128 位' }, 400)

    const { error: updateError } = await serviceClient.auth.admin.updateUserById(userId, { password })
    if (updateError) return jsonResponse({ error: updateError.message }, 400)
    return jsonResponse({ success: true })
  } catch (error) {
    console.error('[admin-reset-password]', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected server error' }, 500)
  }
})
