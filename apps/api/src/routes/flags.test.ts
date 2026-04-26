import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

// ---------------------------------------------------------------------------
// Mock external dependencies BEFORE importing routes
// ---------------------------------------------------------------------------

vi.mock('@clerk/fastify', () => ({
  clerkPlugin: async () => {},
  getAuth: vi.fn(),
}))

vi.mock('@flagforge/db', () => ({
  prisma: {
    organization: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
    },
    flag: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    flagEnvironmentConfig: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    evaluationRollup: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('../lib/config.js', () => ({
  buildSdkConfig: vi.fn().mockResolvedValue({ flags: [], version: 1, etag: 'test-etag' }),
}))

vi.mock('./sdk.js', () => ({
  broadcastConfigUpdate: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { getAuth } from '@clerk/fastify'
import { prisma } from '@flagforge/db'
import { flagRoutes } from './flags.js'

const mockGetAuth = vi.mocked(getAuth)
const mockPrisma = vi.mocked(prisma, true)

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(flagRoutes, { prefix: '/v1' })
  await app.ready()
  return app
}

// ---------------------------------------------------------------------------
// Default mock data
// ---------------------------------------------------------------------------

const mockOrg = { id: 'org-1', clerkOrgId: 'clerk-org-1', name: 'Acme', slug: 'acme' }
const mockEnvDev = { id: 'env-dev', key: 'development', name: 'Development', projectId: 'proj-1' }
const mockEnvStaging = { id: 'env-staging', key: 'staging', name: 'Staging', projectId: 'proj-1' }
const mockEnvProd = { id: 'env-prod', key: 'production', name: 'Production', projectId: 'proj-1' }

const mockProject = {
  id: 'proj-1',
  orgId: 'org-1',
  name: 'My Project',
  slug: 'my-project',
  environments: [mockEnvDev, mockEnvStaging, mockEnvProd],
}

const mockFlag = {
  id: 'flag-1',
  projectId: 'proj-1',
  key: 'dark-mode',
  name: 'Dark Mode',
  description: null,
  type: 'BOOLEAN',
  variants: [{ key: 'off', value: false }, { key: 'on', value: true }],
  archivedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  envConfigs: [],
}

const mockEnvConfig = {
  id: 'cfg-1',
  flagId: 'flag-1',
  environmentId: 'env-dev',
  enabled: false,
  defaultVariantKey: 'off',
  rules: [],
  rollout: {},
  version: 1,
}

// ---------------------------------------------------------------------------
// Helper: set up auth mock
// ---------------------------------------------------------------------------

function authAs(orgId = 'clerk-org-1', userId = 'user-1') {
  mockGetAuth.mockReturnValue({ orgId, userId } as any)
}

function noAuth() {
  mockGetAuth.mockReturnValue({ orgId: null, userId: null } as any)
}

// ---------------------------------------------------------------------------
// Tests: GET /v1/projects/:projectId/flags
// ---------------------------------------------------------------------------

describe('GET /v1/projects/:projectId/flags', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when not authenticated', async () => {
    noAuth()
    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj-1/flags' })
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns flags list for authenticated user', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(mockProject as any)
    mockPrisma.flag.findMany.mockResolvedValue([mockFlag] as any)

    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj-1/flags' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ key: 'dark-mode' })
  })

  it('returns empty array when no flags exist', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(mockProject as any)
    mockPrisma.flag.findMany.mockResolvedValue([])

    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj-1/flags' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('returns 500 when project is not found (throws)', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj-1/flags' })
    // requireProjectAccess throws 'Project not found' which Fastify wraps as 500
    expect(res.statusCode).toBe(500)
  })

  it('calls prisma.flag.findMany with correct projectId', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(mockProject as any)
    mockPrisma.flag.findMany.mockResolvedValue([])

    await app.inject({ method: 'GET', url: '/v1/projects/proj-1/flags' })
    expect(mockPrisma.flag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: 'proj-1' }) })
    )
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /v1/projects/:projectId/flags
// ---------------------------------------------------------------------------

describe('POST /v1/projects/:projectId/flags', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when not authenticated', async () => {
    noAuth()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/flags',
      payload: { key: 'my-flag', name: 'My Flag' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 for invalid flag key (uppercase)', async () => {
    authAs()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/flags',
      payload: { key: 'MyFlag', name: 'My Flag' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for missing key field', async () => {
    authAs()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/flags',
      payload: { name: 'My Flag' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for empty name', async () => {
    authAs()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/flags',
      payload: { key: 'my-flag', name: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('creates a BOOLEAN flag and returns 201', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(mockProject as any)
    mockPrisma.auditLog.create.mockResolvedValue({} as any)

    const createdFlag = {
      ...mockFlag,
      key: 'dark-mode',
      name: 'Dark Mode',
      type: 'BOOLEAN',
      envConfigs: [
        { ...mockEnvConfig, environment: mockEnvDev },
        { ...mockEnvConfig, environmentId: 'env-staging', environment: mockEnvStaging },
        { ...mockEnvConfig, environmentId: 'env-prod', environment: mockEnvProd },
      ],
    }
    mockPrisma.flag.create.mockResolvedValue(createdFlag as any)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/flags',
      payload: { key: 'dark-mode', name: 'Dark Mode', type: 'BOOLEAN' },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body).toMatchObject({ key: 'dark-mode', name: 'Dark Mode', type: 'BOOLEAN' })
  })

  it('creates envConfigs for each environment', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(mockProject as any)
    mockPrisma.flag.create.mockResolvedValue(mockFlag as any)
    mockPrisma.auditLog.create.mockResolvedValue({} as any)

    await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/flags',
      payload: { key: 'my-flag', name: 'My Flag' },
    })

    const createCall = mockPrisma.flag.create.mock.calls[0]?.[0]
    expect(createCall?.data?.envConfigs?.create).toHaveLength(3)
  })

  it('creates MULTIVARIATE flag with control/treatment variants', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(mockProject as any)

    const mvFlag = { ...mockFlag, type: 'MULTIVARIATE', variants: [{ key: 'control', value: null }, { key: 'treatment', value: null }] }
    mockPrisma.flag.create.mockResolvedValue(mvFlag as any)
    mockPrisma.auditLog.create.mockResolvedValue({} as any)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/flags',
      payload: { key: 'my-mv-flag', name: 'MV Flag', type: 'MULTIVARIATE' },
    })

    expect(res.statusCode).toBe(201)
    const createCall = mockPrisma.flag.create.mock.calls[0]?.[0]
    expect(createCall?.data?.variants).toContainEqual({ key: 'control', value: null })
    expect(createCall?.data?.variants).toContainEqual({ key: 'treatment', value: null })
  })

  it('defaults to BOOLEAN type when type is not provided', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(mockProject as any)
    mockPrisma.flag.create.mockResolvedValue(mockFlag as any)
    mockPrisma.auditLog.create.mockResolvedValue({} as any)

    await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/flags',
      payload: { key: 'my-flag', name: 'My Flag' },
    })

    const createCall = mockPrisma.flag.create.mock.calls[0]?.[0]
    expect(createCall?.data?.type).toBe('BOOLEAN')
    expect(createCall?.data?.variants).toContainEqual({ key: 'off', value: false })
    expect(createCall?.data?.variants).toContainEqual({ key: 'on', value: true })
  })
})

// ---------------------------------------------------------------------------
// Tests: PUT /v1/flags/:flagId/environments/:envId
// ---------------------------------------------------------------------------

describe('PUT /v1/flags/:flagId/environments/:envId', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when not authenticated', async () => {
    noAuth()
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/flags/flag-1/environments/env-dev',
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when env config not found', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(mockOrg as any)
    mockPrisma.flagEnvironmentConfig.findFirst.mockResolvedValue(null)

    const res = await app.inject({
      method: 'PUT',
      url: '/v1/flags/flag-1/environments/env-dev',
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Config not found' })
  })

  it('returns 404 when org not found', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(null)

    const res = await app.inject({
      method: 'PUT',
      url: '/v1/flags/flag-1/environments/env-dev',
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Org not found' })
  })

  it('updates enabled state and returns the updated config', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(mockOrg as any)
    mockPrisma.flagEnvironmentConfig.findFirst.mockResolvedValue(mockEnvConfig as any)

    const updatedConfig = { ...mockEnvConfig, enabled: true, version: 2 }
    mockPrisma.flagEnvironmentConfig.update.mockResolvedValue(updatedConfig as any)
    mockPrisma.auditLog.create.mockResolvedValue({} as any)

    const res = await app.inject({
      method: 'PUT',
      url: '/v1/flags/flag-1/environments/env-dev',
      payload: { enabled: true },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toMatchObject({ enabled: true, version: 2 })
  })

  it('increments version on update', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(mockOrg as any)
    mockPrisma.flagEnvironmentConfig.findFirst.mockResolvedValue(mockEnvConfig as any)
    mockPrisma.flagEnvironmentConfig.update.mockResolvedValue({ ...mockEnvConfig, version: 2 } as any)
    mockPrisma.auditLog.create.mockResolvedValue({} as any)

    await app.inject({
      method: 'PUT',
      url: '/v1/flags/flag-1/environments/env-dev',
      payload: { enabled: false },
    })

    const updateCall = mockPrisma.flagEnvironmentConfig.update.mock.calls[0]?.[0]
    expect(updateCall?.data?.version).toEqual({ increment: 1 })
  })

  it('returns 400 for invalid body (rollout value out of range)', async () => {
    authAs()
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/flags/flag-1/environments/env-dev',
      payload: { rollout: { on: 150 } }, // > 100 is invalid
    })
    expect(res.statusCode).toBe(400)
  })

  it('updates rules when provided', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(mockOrg as any)
    mockPrisma.flagEnvironmentConfig.findFirst.mockResolvedValue(mockEnvConfig as any)
    mockPrisma.flagEnvironmentConfig.update.mockResolvedValue(mockEnvConfig as any)
    mockPrisma.auditLog.create.mockResolvedValue({} as any)

    const rules = [{
      id: 'rule-1',
      conditions: [{ attribute: 'country', operator: 'equals', values: ['US'] }],
      variantKey: 'on',
    }]

    await app.inject({
      method: 'PUT',
      url: '/v1/flags/flag-1/environments/env-dev',
      payload: { rules },
    })

    const updateCall = mockPrisma.flagEnvironmentConfig.update.mock.calls[0]?.[0]
    expect(updateCall?.data?.rules).toEqual(rules)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /v1/flags/:flagId
// ---------------------------------------------------------------------------

describe('GET /v1/flags/:flagId', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when not authenticated', async () => {
    noAuth()
    const res = await app.inject({ method: 'GET', url: '/v1/flags/flag-1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when org not found', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/v1/flags/flag-1' })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Org not found' })
  })

  it('returns 404 when flag not found', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(mockOrg as any)
    mockPrisma.flag.findFirst.mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/v1/flags/nonexistent' })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Flag not found' })
  })

  it('returns flag when found', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(mockOrg as any)
    mockPrisma.flag.findFirst.mockResolvedValue(mockFlag as any)

    const res = await app.inject({ method: 'GET', url: '/v1/flags/flag-1' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ key: 'dark-mode' })
  })
})

// ---------------------------------------------------------------------------
// Tests: PATCH /v1/flags/:flagId
// ---------------------------------------------------------------------------

describe('PATCH /v1/flags/:flagId', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when not authenticated', async () => {
    noAuth()
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/flags/flag-1',
      payload: { name: 'New Name' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('updates flag name', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(mockOrg as any)
    mockPrisma.flag.findFirst.mockResolvedValue(mockFlag as any)
    mockPrisma.flag.update.mockResolvedValue({ ...mockFlag, name: 'New Name' } as any)
    mockPrisma.auditLog.create.mockResolvedValue({} as any)

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/flags/flag-1',
      payload: { name: 'New Name' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ name: 'New Name' })
  })

  it('archives a flag when archived: true', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(mockOrg as any)
    mockPrisma.flag.findFirst.mockResolvedValue(mockFlag as any)
    const archivedAt = new Date()
    mockPrisma.flag.update.mockResolvedValue({ ...mockFlag, archivedAt } as any)
    mockPrisma.auditLog.create.mockResolvedValue({} as any)

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/flags/flag-1',
      payload: { archived: true },
    })

    expect(res.statusCode).toBe(200)
    const updateCall = mockPrisma.flag.update.mock.calls[0]?.[0]
    expect(updateCall?.data?.archivedAt).toBeInstanceOf(Date)
  })

  it('unarchives a flag when archived: false', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(mockOrg as any)
    mockPrisma.flag.findFirst.mockResolvedValue(mockFlag as any)
    mockPrisma.flag.update.mockResolvedValue({ ...mockFlag, archivedAt: null } as any)
    mockPrisma.auditLog.create.mockResolvedValue({} as any)

    await app.inject({
      method: 'PATCH',
      url: '/v1/flags/flag-1',
      payload: { archived: false },
    })

    const updateCall = mockPrisma.flag.update.mock.calls[0]?.[0]
    expect(updateCall?.data?.archivedAt).toBeNull()
  })

  it('returns 404 when flag not found', async () => {
    authAs()
    mockPrisma.organization.findUnique.mockResolvedValue(mockOrg as any)
    mockPrisma.flag.findFirst.mockResolvedValue(null)

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/flags/nonexistent',
      payload: { name: 'X' },
    })

    expect(res.statusCode).toBe(404)
  })
})
