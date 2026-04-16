import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type PluginOption } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import {
  buildDevHarnessPortalEntryContext,
  buildDevHarnessPortalOnboardingContext,
  buildDevHarnessPortalRegistrationResult,
  buildDevHarnessPortalSessionProjectResult,
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

function devHarnessPortalApiPlugin(): PluginOption {
  return {
    name: 'dev-harness-portal-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const enabled = String(process.env.VITE_DEV_AUTH_HARNESS_ENABLED || '').trim().toLowerCase() === 'true'
        const method = String(req.method || 'GET').toUpperCase()
        const pathName = String(req.url || '').split('?')[0]

        if (!enabled || !pathName.startsWith('/api/v1/portal/')) {
          next()
          return
        }

        const actorId = typeof req.headers['x-actor-id'] === 'string' ? req.headers['x-actor-id'] : ''
        const actorRole = typeof req.headers['x-actor-role'] === 'string' ? req.headers['x-actor-role'] : ''

        try {
          if (method === 'GET' && pathName === '/api/v1/portal/entry-context') {
            writeJson(res, 200, buildDevHarnessPortalEntryContext({ actorId, actorRole }))
            return
          }

          if (method === 'GET' && pathName === '/api/v1/portal/onboarding-context') {
            writeJson(res, 200, buildDevHarnessPortalOnboardingContext({ actorRole }))
            return
          }

          if (method === 'POST' && pathName === '/api/v1/portal/session-project') {
            const body = await readRequestBody(req) as { projectId?: string }
            writeJson(res, 200, buildDevHarnessPortalSessionProjectResult(body.projectId || ''))
            return
          }

          if (method === 'POST' && pathName === '/api/v1/portal/registration') {
            const body = await readRequestBody(req) as { projectId?: string; projectIds?: string[] }
            writeJson(res, 200, buildDevHarnessPortalRegistrationResult(body))
            return
          }
        } catch (error) {
          const code = error instanceof Error ? error.message : 'dev_harness_portal_api_error'
          writeJson(res, 400, {
            error: code,
            message: code,
          })
          return
        }

        next()
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
