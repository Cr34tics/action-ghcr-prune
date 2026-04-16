import { describe, it, expect, vi } from 'vitest'
import { dockerAPIGet, getBackoffMs, Docker404Error } from '../src/docker-api'
import type { HttpClient, HttpClientResponse } from '@actions/http-client'
import type { IncomingMessage } from 'http'

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

describe('Docker404Error', () => {
  it('should be an instance of Error', () => {
    const error = new Docker404Error(
      'https://ghcr.io/v2/owner/container/manifests/latest',
    )
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('Docker404Error')
    expect(error.message).toBe(
      'Got 404 for https://ghcr.io/v2/owner/container/manifests/latest',
    )
  })
})

describe('dockerAPIGet', () => {
  let mockClient: HttpClient

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

  it('should throw Docker404Error on 404 from both V1 and V2', async () => {
    const failResponse = mockHttpResponse(404)
    mockClient = {
      get: vi.fn().mockResolvedValue(failResponse),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container')

    await expect(get('manifests/latest')).rejects.toThrow(Docker404Error)
    // Single attempt: 2 calls (V1 + V2)
    expect(mockClient.get).toHaveBeenCalledTimes(2)
  })

  it('should throw regular error on non-404 errors', async () => {
    const failResponse = mockHttpResponse(500)
    mockClient = {
      get: vi.fn().mockResolvedValue(failResponse),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container')

    await expect(get('manifests/latest')).rejects.toThrow(
      'All Docker API requests',
    )
    await expect(get('manifests/latest')).rejects.not.toThrow(Docker404Error)
  })

  it('should throw regular error when only V1 returns 404 but V2 returns 500', async () => {
    const fail404 = mockHttpResponse(404)
    const fail500 = mockHttpResponse(500)
    mockClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce(fail404)
        .mockResolvedValueOnce(fail500),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container')

    await expect(get('manifests/latest')).rejects.toThrow(
      'All Docker API requests',
    )
    await expect(get('manifests/latest')).rejects.not.toThrow(Docker404Error)
  })

  it('should throw regular error when only V2 returns 404 but V1 returns 500', async () => {
    const fail500 = mockHttpResponse(500)
    const fail404 = mockHttpResponse(404)
    mockClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce(fail500)
        .mockResolvedValueOnce(fail404),
    } as unknown as HttpClient

    const get = dockerAPIGet(mockClient, 'token', 'owner', 'container')

    await expect(get('manifests/latest')).rejects.toThrow(
      'All Docker API requests',
    )
    await expect(get('manifests/latest')).rejects.not.toThrow(Docker404Error)
  })
})
