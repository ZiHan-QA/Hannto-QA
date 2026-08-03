import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type ImportUser = {
  row_number?: number
  name?: string
  email?: string
  password?: string
  role?: string
  resource_participant?: boolean
  daily_capacity?: number
  employee_category?: string | null
  supplier_name?: string | null
  hire_date?: string | null
  onboarding_project_name?: string | null
  contract_end_date?: string | null
}

const validRoles = new Set(['admin', 'qa_lead', 'tester'])
const validCategories = new Set([
  'hannto_regular',
  'hannto_contract',
  'third_party_supplier',
  'unigroup_hannto',
  'meijie_technology',
  'intern',
])

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function cleanText(value: unknown) {
  return String(value ?? '').trim()
}

function nullableText(value: unknown) {
  const normalized = cleanText(value)
  return normalized || null
}

function optionalProjectName(value: unknown) {
  const normalized = cleanText(value)
  if (!normalized) return null
  const compact = normalized.toLowerCase().replace(/\s+/g, '')
  // BU 是组织分类，不是具体项目；导入时按“暂不关联项目”处理。
  if (compact === '小米bu' || compact === '消费bu' || compact === '新业务bu') return null
  return normalized
}

function isIsoDate(value: string | null) {
  return value === null || /^\d{4}-\d{2}-\d{2}$/.test(value)
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
      return jsonResponse({ error: '缺少服务端配置或登录授权' }, 401)
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
    if (callerProfile?.role !== 'admin') return jsonResponse({ error: '仅系统管理员可批量创建成员' }, 403)

    const body = await request.json().catch(() => ({})) as { users?: ImportUser[] }
    if (!Array.isArray(body.users) || body.users.length === 0) {
      return jsonResponse({ error: '导入表格中没有可创建的成员' }, 400)
    }
    if (body.users.length > 100) return jsonResponse({ error: '单次最多导入 100 人' }, 400)

    const { data: department, error: departmentError } = await serviceClient
      .from('departments')
      .select('id,supervisor_id')
      .eq('name', '软件质量')
      .eq('status', 'active')
      .maybeSingle()
    if (departmentError) throw departmentError
    if (!department) return jsonResponse({ error: '未找到“软件质量”部门，请先执行部门管理数据库迁移' }, 400)

    const { data: suppliers, error: suppliersError } = await serviceClient
      .from('department_suppliers')
      .select('id,name')
      .eq('department_id', department.id)
      .eq('status', 'active')
    if (suppliersError) throw suppliersError
    const supplierByName = new Map<string, string>()
    for (const supplier of suppliers || []) {
      const storedName = cleanText(supplier.name).toLowerCase()
      if (!storedName) continue
      supplierByName.set(storedName, supplier.id)
      // “科之锐”是历史数据名称；产品侧已统一显示为“科锐”。
      // 批量导入同时兼容新旧名称，避免数据库迁移前后出现假性停用。
      if (storedName === '科之锐') supplierByName.set('科锐', supplier.id)
      if (storedName === '科锐') supplierByName.set('科之锐', supplier.id)
    }
    const availableSupplierNames = [...new Set(
      (suppliers || []).map(item => cleanText(item.name) === '科之锐' ? '科锐' : cleanText(item.name))
    )].filter(Boolean)

    const { data: projects, error: projectsError } = await serviceClient
      .from('qa_projects')
      .select('id,name')
      .neq('status', 'archived')
    if (projectsError) throw projectsError
    const projectsByName = new Map<string, string[]>()
    for (const project of projects || []) {
      const key = cleanText(project.name).toLowerCase()
      const ids = projectsByName.get(key) || []
      ids.push(project.id)
      projectsByName.set(key, ids)
    }

    const seenEmails = new Set<string>()
    const results: Record<string, unknown>[] = []

    for (let index = 0; index < body.users.length; index += 1) {
      const source = body.users[index] || {}
      const rowNumber = Number(source.row_number) || index + 2
      const name = cleanText(source.name)
      const email = cleanText(source.email).toLowerCase()
      const password = String(source.password || '')
      const role = cleanText(source.role)
      const resourceParticipant = source.resource_participant !== false
      const dailyCapacity = Number(source.daily_capacity || 1)
      const employeeCategory = nullableText(source.employee_category)
      const supplierName = nullableText(source.supplier_name)
      const hireDate = nullableText(source.hire_date)
      const projectName = optionalProjectName(source.onboarding_project_name)
      const contractEndDate = nullableText(source.contract_end_date)

      try {
        if (!name) throw new Error('姓名不能为空')
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱格式不正确')
        if (seenEmails.has(email)) throw new Error('表格内邮箱重复')
        seenEmails.add(email)
        if (password.length < 8 || password.length > 128) throw new Error('初始密码必须为 8 到 128 位')
        if (!validRoles.has(role)) throw new Error('职责值无效')
        if (!Number.isFinite(dailyCapacity) || dailyCapacity <= 0 || dailyCapacity > 5) {
          throw new Error('每日容量必须大于 0 且不超过 5')
        }
        if (employeeCategory && !validCategories.has(employeeCategory)) throw new Error('员工类别值无效')
        if (!isIsoDate(hireDate) || !isIsoDate(contractEndDate)) throw new Error('日期必须为 YYYY-MM-DD')
        if (employeeCategory === 'third_party_supplier' && !supplierName) {
          throw new Error('第三方供应商员工必须填写供应商')
        }
        if (employeeCategory !== 'third_party_supplier' && supplierName) {
          throw new Error('仅第三方供应商员工可以填写供应商')
        }
        const supplierId = supplierName ? supplierByName.get(supplierName.toLowerCase()) : null
        if (supplierName && !supplierId) {
          throw new Error(`供应商“${supplierName}”不存在或已停用；当前可用：${availableSupplierNames.join('、') || '无'}`)
        }
        const projectIds = projectName ? projectsByName.get(projectName.toLowerCase()) || [] : []
        if (projectName && projectIds.length === 0) throw new Error(`入职项目“${projectName}”不存在`)
        if (projectIds.length > 1) throw new Error(`入职项目“${projectName}”存在同名项目，请先规范项目名称`)

        const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name },
        })
        if (createError || !created.user) throw new Error(createError?.message || '账号创建失败')

        const userId = created.user.id
        try {
          const { error: profileUpdateError } = await serviceClient
            .from('profiles')
            .update({
              name,
              role,
              resource_participant: resourceParticipant,
              daily_capacity: dailyCapacity,
            })
            .eq('id', userId)
          if (profileUpdateError) throw profileUpdateError

          const { error: memberError } = await serviceClient
            .from('department_members')
            .upsert({
              department_id: department.id,
              member_id: userId,
              reports_to_id: department.supervisor_id,
              employee_category: employeeCategory,
              supplier_id: supplierId,
              hire_date: hireDate,
              onboarding_project_id: projectIds[0] || null,
              contract_end_date: employeeCategory === 'third_party_supplier' ? contractEndDate : null,
              employment_status: 'active',
            }, { onConflict: 'department_id,member_id' })
          if (memberError) throw memberError
        } catch (writeError) {
          await serviceClient.auth.admin.deleteUser(userId).catch(() => undefined)
          throw writeError
        }

        results.push({ row_number: rowNumber, email, name, success: true, user_id: userId })
      } catch (rowError) {
        results.push({
          row_number: rowNumber,
          email,
          name,
          success: false,
          error: rowError instanceof Error ? rowError.message : '未知错误',
        })
      }
    }

    const succeeded = results.filter(item => item.success).length
    return jsonResponse({
      success: succeeded === results.length,
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    })
  } catch (error) {
    console.error('[admin-bulk-create-users]', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected server error' }, 500)
  }
})
