import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type PluginOption } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import {
  buildDevHarnessPortalBankStatementsSummary,
  buildDevHarnessPortalBankStatementHandoffResult,
  buildDevHarnessPortalCloseCashflowWeekResult,
  buildDevHarnessPortalExpenseIntakeDraftResult,
  buildDevHarnessPortalExpenseIntakeBulkUpsertResult,
  buildDevHarnessPortalUpsertCashflowWeekResult,
  buildDevHarnessPortalDashboardSummary,
  buildDevHarnessPortalEntryContext,
  buildDevHarnessPortalOnboardingContext,
  buildDevHarnessPortalPayrollSummary,
  buildDevHarnessPortalExpenseIntakeEvidenceSyncResult,
  buildDevHarnessPortalExpenseIntakeProjectResult,
  buildDevHarnessPortalRegistrationResult,
  buildDevHarnessPortalSaveWeeklyExpenseResult,
  buildDevHarnessPortalSubmitWeeklySubmissionResult,
  buildDevHarnessPortalSessionProjectResult,
  buildDevHarnessPortalVarianceFlagResult,
  buildDevHarnessPortalWeeklyExpensesSummary,
} from './src/app/platform/dev-harness-portal-api'

function getVendorChunkName(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined

  if (
    id.includes('/react/') ||
    id.includes('/react-dom/') ||
    id.includes('/react-router/') ||
    id.includes('/scheduler/') ||
    id.includes('/@remix-run/router/')
  ) {
    return 'react-vendor'
  }

  if (id.includes('/firebase/')) {
    return 'firebase-vendor'
  }

  if (
    id.includes('/@radix-ui/') ||
    id.includes('/cmdk/') ||
    id.includes('/vaul/') ||
    id.includes('/embla-carousel') ||
    id.includes('/react-day-picker/') ||
    id.includes('/input-otp/') ||
    id.includes('/react-resizable-panels/')
  ) {
    return 'ui-vendor'
  }

  if (
    id.includes('/@mui/') ||
    id.includes('/@emotion/') ||
    id.includes('/@popperjs/')
  ) {
    return 'mui-vendor'
  }

  if (
    id.includes('/sonner/') ||
    id.includes('/lucide-react/') ||
    id.includes('/motion/') ||
    id.includes('/date-fns/') ||
    id.includes('/zod/') ||
    id.includes('/clsx/') ||
    id.includes('/class-variance-authority/') ||
    id.includes('/tailwind-merge/')
  ) {
    return 'app-vendor'
  }

  return undefined
}

function readRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

export async function resolveDevHarnessPortalApiResponse(params: {
  enabled: boolean
  method: string
  url: string
  actorId: string
  actorRole: string
  readBody: () => Promise<unknown>
}): Promise<{
  handled: boolean
  statusCode?: number
  payload?: unknown
}> {
  const method = String(params.method || 'GET').toUpperCase()
  const requestUrl = new URL(params.url || '/', 'http://localhost')
  const pathName = requestUrl.pathname
  const isPortalRoute = pathName.startsWith('/api/v1/portal/')
  const isCashflowWeekCloseRoute = pathName === '/api/v1/cashflow/weeks/close'
  const isCashflowWeekUpsertRoute = pathName === '/api/v1/cashflow/weeks/upsert'
  const isCashflowWeekVarianceRoute = pathName === '/api/v1/cashflow/weeks/variance-flag'

  if (!params.enabled || (!isPortalRoute && !isCashflowWeekCloseRoute && !isCashflowWeekUpsertRoute && !isCashflowWeekVarianceRoute)) {
    return { handled: false }
  }

  try {
    if (method === 'GET' && pathName === '/api/v1/portal/entry-context') {
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalEntryContext({ actorId: params.actorId, actorRole: params.actorRole }),
      }
    }

    if (method === 'GET' && pathName === '/api/v1/portal/onboarding-context') {
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalOnboardingContext({ actorRole: params.actorRole }),
      }
    }

    if (method === 'GET' && pathName === '/api/v1/portal/dashboard-summary') {
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalDashboardSummary({
          actorId: params.actorId,
          actorRole: params.actorRole,
          projectId: requestUrl.searchParams.get('projectId') || '',
        }),
      }
    }

    if (method === 'GET' && pathName === '/api/v1/portal/payroll-summary') {
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalPayrollSummary({
          actorId: params.actorId,
          actorRole: params.actorRole,
        }),
      }
    }

    if (method === 'GET' && pathName === '/api/v1/portal/weekly-expenses-summary') {
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalWeeklyExpensesSummary({
          actorId: params.actorId,
          actorRole: params.actorRole,
        }),
      }
    }

    if (method === 'GET' && pathName === '/api/v1/portal/bank-statements-summary') {
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalBankStatementsSummary({
          actorId: params.actorId,
          actorRole: params.actorRole,
        }),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/portal/weekly-expenses/save') {
      const body = await params.readBody()
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalSaveWeeklyExpenseResult({
          actorId: params.actorId,
          actorRole: params.actorRole,
          command: body as Parameters<typeof buildDevHarnessPortalSaveWeeklyExpenseResult>[0]['command'],
        }),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/portal/expense-intake/draft') {
      const body = await params.readBody()
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalExpenseIntakeDraftResult({
          actorId: params.actorId,
          actorRole: params.actorRole,
          command: body as Parameters<typeof buildDevHarnessPortalExpenseIntakeDraftResult>[0]['command'],
        }),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/portal/expense-intake/bulk-upsert') {
      const body = await params.readBody()
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalExpenseIntakeBulkUpsertResult({
          actorId: params.actorId,
          actorRole: params.actorRole,
          command: body as Parameters<typeof buildDevHarnessPortalExpenseIntakeBulkUpsertResult>[0]['command'],
        }),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/portal/expense-intake/evidence-sync') {
      const body = await params.readBody()
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalExpenseIntakeEvidenceSyncResult({
          actorId: params.actorId,
          actorRole: params.actorRole,
          command: body as Parameters<typeof buildDevHarnessPortalExpenseIntakeEvidenceSyncResult>[0]['command'],
        }),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/portal/expense-intake/project') {
      const body = await params.readBody()
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalExpenseIntakeProjectResult({
          actorId: params.actorId,
          actorRole: params.actorRole,
          command: body as Parameters<typeof buildDevHarnessPortalExpenseIntakeProjectResult>[0]['command'],
        }),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/portal/weekly-submissions/submit') {
      const body = await params.readBody()
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalSubmitWeeklySubmissionResult({
          actorId: params.actorId,
          actorRole: params.actorRole,
          command: body as Parameters<typeof buildDevHarnessPortalSubmitWeeklySubmissionResult>[0]['command'],
        }),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/portal/bank-statements/handoff') {
      const body = await params.readBody()
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalBankStatementHandoffResult({
          actorId: params.actorId,
          actorRole: params.actorRole,
          command: body as Parameters<typeof buildDevHarnessPortalBankStatementHandoffResult>[0]['command'],
        }),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/cashflow/weeks/close') {
      const body = await params.readBody()
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalCloseCashflowWeekResult({
          actorId: params.actorId,
          actorRole: params.actorRole,
          command: body as Parameters<typeof buildDevHarnessPortalCloseCashflowWeekResult>[0]['command'],
        }),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/cashflow/weeks/upsert') {
      const body = await params.readBody()
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalUpsertCashflowWeekResult({
          actorId: params.actorId,
          actorRole: params.actorRole,
          command: body as Parameters<typeof buildDevHarnessPortalUpsertCashflowWeekResult>[0]['command'],
        }),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/cashflow/weeks/variance-flag') {
      const body = await params.readBody()
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalVarianceFlagResult({
          actorId: params.actorId,
          actorRole: params.actorRole,
          command: body as Parameters<typeof buildDevHarnessPortalVarianceFlagResult>[0]['command'],
        }),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/portal/session-project') {
      const body = await params.readBody() as { projectId?: string }
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalSessionProjectResult(body.projectId || ''),
      }
    }

    if (method === 'POST' && pathName === '/api/v1/portal/registration') {
      const body = await params.readBody() as { projectId?: string; projectIds?: string[] }
      return {
        handled: true,
        statusCode: 200,
        payload: buildDevHarnessPortalRegistrationResult(body),
      }
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : 'dev_harness_portal_api_error'
    return {
      handled: true,
      statusCode: 400,
      payload: {
        error: code,
        message: code,
      },
    }
  }

  return { handled: false }
}

function devHarnessPortalApiPlugin(): PluginOption {
  return {
    name: 'dev-harness-portal-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const enabled = String(process.env.VITE_DEV_AUTH_HARNESS_ENABLED || '').trim().toLowerCase() === 'true'
        const method = String(req.method || 'GET').toUpperCase()

        const actorId = typeof req.headers['x-actor-id'] === 'string' ? req.headers['x-actor-id'] : ''
        const actorRole = typeof req.headers['x-actor-role'] === 'string' ? req.headers['x-actor-role'] : ''
        const response = await resolveDevHarnessPortalApiResponse({
          enabled,
          method,
          url: req.url || '/',
          actorId,
          actorRole,
          readBody: async () => readRequestBody(req),
        })

        if (!response.handled) {
          next()
          return
        }

        writeJson(res, response.statusCode || 200, response.payload)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    devHarnessPortalApiPlugin(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return getVendorChunkName(id)
        },
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
