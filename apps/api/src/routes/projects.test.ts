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
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    apiKey: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../lib/api-key.js', () => ({
  generateApiKey: vi.fn().mockReturnValue({
    raw: 'ff_server_test123',
    hash: 'hashed_value',
    prefix: 'ff_server',
  }),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { getAuth } from '@clerk/fastify'
import { prisma } from '@flagforge/db'
import { projectRoutes } from './projects.js'

const mockGetAuth = vi.mocked(getAuth)
const mockPrisma = vi.mocked(prisma, true)

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(projectRoutes, { prefix: '/v1' })
  await app.ready()
  return app
}

// ---------------------------------------------------------------------------
// Default mock data
// ---------------------------------------------------------------------------

const mockOrg = {
  id: 'org-1',
  clerkOrgId: 'clerk-org-1',
  name: 'Acme',
  slug: 'acme',
  projects: [],
}

const mockEnvDev = { id: 'env-dev', key: 'development', name: 'Development', projectId: 'proj-1' }
const mockEnvStaging = { id: 'env-staging', key: 'staging', name: 'Staging', projectId: 'proj-1' }
const mockEnvProd = { id: 'env-prod', key: 'production', name: 'Production', projectId: 'proj-1' }

const mockProject = {
  id: 'proj-1',
  orgId: 'org-1',
  name: 'My Project',
  slug: 'my-project',
  environments: [mockEnvDev, mockEnvStaging, mockEnvProd],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function authAs(orgId = 'clerk-org-1', userId = 'user-1') {
  mockGetAuth.mockReturnValue({ orgId, userId } as any)
}

function noAuth() {
  mockGetAuth.mockReturnValue({ orgId: null, userId: null } as any)
}

// ---------------------------------------------------------------------------
// Tests: GET /v1/projects
// ---------------------------------------------------------------------------

describe('GET /v1/projects', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when not authenticated', async () => {
    noAuth()
    const res = await app.inject({ method: 'GET', url: '/v1/projects' })
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns projects list for authenticated user', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue({
      ...mockOrg,
      projects: [mockProject],
    } as any)

    const res = await app.inject({ method: 'GET', url: '/v1/projects' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ name: 'My Project', slug: 'my-project' })
  })

  it('returns empty array when org has no projects', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue({ ...mockOrg, projects: [] } as any)

    const res = await app.inject({ method: 'GET', url: '/v1/projects' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('upserts organization on every request', async () => {
    authAs('new-org-id', 'user-2')
    mockPrisma.organization.upsert.mockResolvedValue({ ...mockOrg, projects: [] } as any)

    await app.inject({ method: 'GET', url: '/v1/projects' })

    expect(mockPrisma.organization.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clerkOrgId: 'new-org-id' },
        create: expect.objectContaining({ clerkOrgId: 'new-org-id' }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /v1/projects
// ---------------------------------------------------------------------------

describe('POST /v1/projects', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when not authenticated', async () => {
    noAuth()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: 'My Project' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 for empty project name', async () => {
    authAs()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when name is missing', async () => {
    authAs()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('creates project and returns 201', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.create.mockResolvedValue(mockProject as any)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: 'My Project' },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body).toMatchObject({ name: 'My Project' })
  })

  it('creates project with 3 environments (dev/staging/prod)', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.create.mockResolvedValue(mockProject as any)

    await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: 'New Project' },
    })

    const createCall = mockPrisma.project.create.mock.calls[0]?.[0]
    const envCreates = createCall?.data?.environments?.create
    expect(envCreates).toHaveLength(3)
    expect(envCreates).toContainEqual({ key: 'development', name: 'Development' })
    expect(envCreates).toContainEqual({ key: 'staging', name: 'Staging' })
    expect(envCreates).toContainEqual({ key: 'production', name: 'Production' })
  })

  it('slugifies project name correctly', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.create.mockResolvedValue(mockProject as any)

    await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: 'My Awesome Project!' },
    })

    const createCall = mockPrisma.project.create.mock.calls[0]?.[0]
    expect(createCall?.data?.slug).toBe('my-awesome-project')
  })

  it('collapses multiple spaces to a single dash in slug', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.create.mockResolvedValue(mockProject as any)

    await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: 'Hello   World' },
    })

    // The slug logic uses /\s+/g which collapses consecutive spaces to one dash
    const createCall = mockPrisma.project.create.mock.calls[0]?.[0]
    expect(createCall?.data?.slug).toBe('hello-world')
  })

  it('returns 400 for name longer than 100 chars', async () => {
    authAs()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: 'a'.repeat(101) },
    })
    expect(res.statusCode).toBe(400)
  })

  it('includes environments in response', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.create.mockResolvedValue(mockProject as any)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: { name: 'My Project' },
    })

    const body = JSON.parse(res.body)
    expect(body.environments).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /v1/projects/:projectId/api-keys
// ---------------------------------------------------------------------------

describe('GET /v1/projects/:projectId/api-keys', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when not authenticated', async () => {
    noAuth()
    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj-1/api-keys' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when project not found', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj-1/api-keys' })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Project not found' })
  })

  it('returns api keys with keyHash stripped', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(mockProject as any)

    const mockKeys = [
      {
        id: 'key-1',
        keyHash: 'secret_hash',
        keyPrefix: 'ff_server',
        type: 'SERVER',
        environment: mockEnvDev,
        createdAt: new Date(),
      },
    ]
    mockPrisma.apiKey.findMany.mockResolvedValue(mockKeys as any)

    const res = await app.inject({ method: 'GET', url: '/v1/projects/proj-1/api-keys' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
    // keyHash should be stripped from response
    expect(body[0]).not.toHaveProperty('keyHash')
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /v1/projects/:projectId/api-keys
// ---------------------------------------------------------------------------

describe('POST /v1/projects/:projectId/api-keys', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when not authenticated', async () => {
    noAuth()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/api-keys',
      payload: { environmentId: 'env-dev', type: 'SERVER' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 for invalid key type', async () => {
    authAs()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/api-keys',
      payload: { environmentId: 'env-dev', type: 'INVALID' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('creates a SERVER api key and returns raw key only once', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(mockProject as any)

    const mockKey = {
      id: 'key-1',
      keyHash: 'hashed_value',
      keyPrefix: 'ff_server',
      type: 'SERVER',
      projectId: 'proj-1',
      environmentId: 'env-dev',
      createdBy: 'user-1',
      createdAt: new Date(),
      revokedAt: null,
    }
    mockPrisma.apiKey.create.mockResolvedValue(mockKey as any)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/api-keys',
      payload: { environmentId: 'env-dev', type: 'SERVER' },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('rawKey', 'ff_server_test123')
    // keyHash should NOT be in response
    expect(body).not.toHaveProperty('keyHash')
  })

  it('returns 404 when project not found', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.project.findFirst.mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects/proj-1/api-keys',
      payload: { environmentId: 'env-dev', type: 'CLIENT' },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Tests: DELETE /v1/api-keys/:keyId
// ---------------------------------------------------------------------------

describe('DELETE /v1/api-keys/:keyId', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when not authenticated', async () => {
    noAuth()
    const res = await app.inject({ method: 'DELETE', url: '/v1/api-keys/key-1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when key not found', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.apiKey.findFirst.mockResolvedValue(null)

    const res = await app.inject({ method: 'DELETE', url: '/v1/api-keys/nonexistent' })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Key not found' })
  })

  it('revokes key by setting revokedAt', async () => {
    authAs()
    mockPrisma.organization.upsert.mockResolvedValue(mockOrg as any)
    mockPrisma.apiKey.findFirst.mockResolvedValue({ id: 'key-1' } as any)
    mockPrisma.apiKey.update.mockResolvedValue({ id: 'key-1', revokedAt: new Date() } as any)

    const res = await app.inject({ method: 'DELETE', url: '/v1/api-keys/key-1' })
    expect(res.statusCode).toBe(204)

    const updateCall = mockPrisma.apiKey.update.mock.calls[0]?.[0]
    expect(updateCall?.data?.revokedAt).toBeInstanceOf(Date)
  })
})
