import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dockerAPIGet, getBackoffMs } from './docker-api'
import type { HttpClient, HttpClientResponse } from '@actions/http-client'
import type { IncomingMessage } from 'http'

vi.mock('@actions/core', () => ({
  info: vi.fn(),
}))

const mockHttpResponse = (statusCode: number): HttpClientResponse => {
  const message = {
    statusCode,
    statusMessage: statusCode === 200 ? 'OK' : 'Not Found',
  } as IncomingMessage

  return {
    message,
    readBody: vi.fn().mockResolvedValue('{}'),
  } as unknown as HttpClientResponse
}

describe('getBackoffMs', () => {
  it('should return exponential backoff values', () => {
    expect(getBackoffMs(0)).toBe(1000)
    expect(getBackoffMs(1)).toBe(2000)
    expect(getBackoffMs(2)).toBe(4000)
    expect(getBackoffMs(3)).toBe(8000)
    expect(getBackoffMs(4)).toBe(16000)
  })

  it('should cap at 30000ms', () => {
    expect(getBackoffMs(5)).toBe(30000)
    expect(getBackoffMs(10)).toBe(30000)
  })
})

describe('dockerAPIGet', () => {
  let mockClient: HttpClient

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return response when V1 succeeds', async () => {
    const successResponse = mockHttpResponse(200)
    mockClient = {
      get: vi.fn().mockResolvedValue(successResponse),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container')
    const result = await get('manifests/latest')

    expect(result).toBe(successResponse)
  })

  it('should return V2 response when V1 fails but V2 succeeds', async () => {
    const failResponse = mockHttpResponse(404)
    const successResponse = mockHttpResponse(200)
    mockClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container')
    const result = await get('manifests/latest')

    expect(result).toBe(successResponse)
  })

  it('should retry on 404 and succeed on subsequent attempt', async () => {
    const failResponse = mockHttpResponse(404)
    const successResponse = mockHttpResponse(200)
    mockClient = {
      get: vi
        .fn()
        // First attempt: V1 returns 404, V2 returns 404
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse)
        // Second attempt: V1 succeeds, V2 also called
        .mockResolvedValueOnce(successResponse)
        .mockResolvedValueOnce(successResponse),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container', 3)
    const promise = get('manifests/latest')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toBe(successResponse)
    // 2 calls per attempt, 2 attempts = 4
    expect(mockClient.get).toHaveBeenCalledTimes(4)
  })

  it('should throw after exhausting retries on persistent 404', async () => {
    const failResponse = mockHttpResponse(404)
    mockClient = {
      get: vi.fn().mockResolvedValue(failResponse),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container', 2)
    const promise = get('manifests/latest')
    const assertion = expect(promise).rejects.toThrow('All Docker API requests')
    await vi.runAllTimersAsync()

    await assertion
    // 3 attempts (0, 1, 2) * 2 calls each (V1 + V2) = 6
    expect(mockClient.get).toHaveBeenCalledTimes(6)
  })

  it('should not retry on non-404 errors', async () => {
    const failResponse = mockHttpResponse(500)
    mockClient = {
      get: vi.fn().mockResolvedValue(failResponse),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container', 3)

    await expect(get('manifests/latest')).rejects.toThrow(
      'All Docker API requests',
    )
    // Only 1 attempt * 2 calls (V1 + V2) = 2
    expect(mockClient.get).toHaveBeenCalledTimes(2)
  })

  it('should use default maxRetries of 5 when not specified', async () => {
    const failResponse = mockHttpResponse(404)
    mockClient = {
      get: vi.fn().mockResolvedValue(failResponse),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container')
    const promise = get('manifests/latest')
    const assertion = expect(promise).rejects.toThrow('All Docker API requests')
    await vi.runAllTimersAsync()

    await assertion
    // 6 attempts (0-5) * 2 calls each = 12
    expect(mockClient.get).toHaveBeenCalledTimes(12)
  })

  it('should retry on 404 from only one manifest version', async () => {
    const fail404 = mockHttpResponse(404)
    const fail500 = mockHttpResponse(500)
    const successResponse = mockHttpResponse(200)
    mockClient = {
      get: vi
        .fn()
        // First attempt: V1 returns 404, V2 returns 500
        .mockResolvedValueOnce(fail404)
        .mockResolvedValueOnce(fail500)
        // Second attempt: V1 succeeds, V2 also called
        .mockResolvedValueOnce(successResponse)
        .mockResolvedValueOnce(successResponse),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container', 3)
    const promise = get('manifests/latest')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toBe(successResponse)
  })

  it('should work with maxRetries of 0 (no retries)', async () => {
    const failResponse = mockHttpResponse(404)
    mockClient = {
      get: vi.fn().mockResolvedValue(failResponse),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container', 0)

    await expect(get('manifests/latest')).rejects.toThrow(
      'All Docker API requests',
    )
    // 1 attempt * 2 calls = 2
    expect(mockClient.get).toHaveBeenCalledTimes(2)
  })
})
