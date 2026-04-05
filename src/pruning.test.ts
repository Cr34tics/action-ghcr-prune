import { describe, it, expect, vi } from 'vitest'
import * as core from '@actions/core'
import {
  getPruningList,
  prune,
  processManifestsWithRetryQueue,
} from './pruning'
import { Docker404Error } from './docker-api'
import type { ContainerVersion, DockerManifest } from './types'

// Mock @actions/core to prevent GitHub Actions annotations in test output
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  notice: vi.fn(),
  warning: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
}))

// Mock delay to avoid actual waiting in tests
vi.mock('./docker-api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    delay: vi.fn().mockResolvedValue(undefined),
  }
})

describe('getPruningList', () => {
  const version = (
    id: number,
    name: string,
    created_at: string,
  ): ContainerVersion => ({
    id,
    name,
    created_at,
    metadata: {
      container: {
        tags: [],
      },
    },
  })

  it('should return all versions to prune', async () => {
    const listVersions = (): Promise<{ data: ContainerVersion[] }> =>
      Promise.resolve({
        data: [
          version(245301, '1.0.4', '2019-11-05T22:49:04Z'),
          version(209672, '1.0.3', '2019-10-29T15:42:11Z'),
        ],
      })
    const pruningFilter = (): boolean => true

    const pruningList = await getPruningList(listVersions, pruningFilter)()

    expect(pruningList).toEqual([
      version(245301, '1.0.4', '2019-11-05T22:49:04Z'),
      version(209672, '1.0.3', '2019-10-29T15:42:11Z'),
    ])
  })

  it('should filter out versions to keep', async () => {
    const listVersions = (): Promise<{ data: ContainerVersion[] }> =>
      Promise.resolve({
        data: [
          version(245301, '1.0.4', '2019-11-05T22:49:04Z'),
          version(209672, '1.0.3', '2019-10-29T15:42:11Z'),
        ],
      })
    const pruningFilter = ({ name }: ContainerVersion): boolean =>
      name === '1.0.3'

    const pruningList = await getPruningList(listVersions, pruningFilter)()

    expect(pruningList).toEqual([
      version(209672, '1.0.3', '2019-10-29T15:42:11Z'),
    ])
  })

  it('should crawl through pages of versions', async () => {
    const listVersions = (
      pageSize: number,
      page = 1,
    ): Promise<{ data: ContainerVersion[] }> =>
      Promise.resolve({
        data: Array((pageSize / 2) * (3 - page))
          .fill(0)
          .map((_, i) =>
            version(
              (page - 1) * 100 + i,
              `1.0.${String(i)}`,
              '2019-11-05T22:49:04Z',
            ),
          ),
      })
    const pruningFilter = ({ id }: ContainerVersion): boolean => id % 2 === 0

    const pruningList = await getPruningList(listVersions, pruningFilter)()

    expect(pruningList.length).toEqual(75)
    expect(pruningList[71]).toEqual(
      version(142, '1.0.42', '2019-11-05T22:49:04Z'),
    )
  })

  it('should keep last `x` versions sorted by created date', async () => {
    const listVersions = (): Promise<{ data: ContainerVersion[] }> =>
      Promise.resolve({
        data: [
          version(100001, '1.0.1', '2020-01-29T15:42:11Z'),
          version(100003, '1.0.3', '2020-10-29T15:42:11Z'),
          version(100002, '1.0.2', '2020-03-29T15:42:11Z'),
          version(100004, '1.0.4', '2020-11-05T22:49:04Z'),
          version(100000, '1.0.0', '2019-10-29T15:42:11Z'),
        ],
      })
    const pruningFilter = (): boolean => true

    const pruningList = await getPruningList(listVersions, pruningFilter)(3)

    expect(pruningList).toEqual([
      version(100001, '1.0.1', '2020-01-29T15:42:11Z'),
      version(100000, '1.0.0', '2019-10-29T15:42:11Z'),
    ])
  })
})

describe('prune', () => {
  const version = (id: number): ContainerVersion => ({
    id,
    name: `v-${String(id)}`,
    created_at: '2019-11-05T22:49:04Z',
    metadata: {
      container: {
        tags: [],
      },
    },
  })

  it('should prune all versions in pruning list', async () => {
    const pruneVersion = vi.fn()

    const pruningList = [version(100001), version(100000)]

    const pruned = await prune(pruneVersion)(pruningList)

    expect(pruned).toEqual(pruningList)
    expect(pruneVersion).toHaveBeenCalledTimes(2)
    expect(pruneVersion).nthCalledWith(1, pruningList[0])
    expect(pruneVersion).nthCalledWith(2, pruningList[1])
  })

  it('should return 0 when all pruning failed', async () => {
    const pruneVersion = vi.fn().mockRejectedValue(Error('Pruning error'))

    const pruningList = [version(100001), version(100000)]

    const pruned = await prune(pruneVersion)(pruningList)

    expect(pruned).toEqual([])
  })

  it('should not interrupt pruning when encountering error', async () => {
    const pruneVersion = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Error('Pruning error'))
      .mockResolvedValueOnce(undefined)

    const pruningList = [version(100000), version(100001), version(100002)]

    const pruned = await prune(pruneVersion)(pruningList)

    expect(pruned).toEqual([pruningList[0], pruningList[2]])
    expect(pruneVersion).toHaveBeenCalledTimes(3)
    expect(pruneVersion).nthCalledWith(1, pruningList[0])
    expect(pruneVersion).nthCalledWith(2, pruningList[1])
    expect(pruneVersion).nthCalledWith(3, pruningList[2])
  })
})

describe('processManifestsWithRetryQueue', () => {
  const taggedVersion = (id: number, tag: string): ContainerVersion => ({
    id,
    name: `sha256:${String(id)}`,
    created_at: '2019-11-05T22:49:04Z',
    metadata: {
      container: {
        tags: [tag],
      },
    },
  })

  const untaggedVersion = (id: number): ContainerVersion => ({
    id,
    name: `sha256:${String(id)}`,
    created_at: '2019-11-05T22:49:04Z',
    metadata: {
      container: {
        tags: [],
      },
    },
  })

  const multiPlatManifest = (digests: string[]): DockerManifest => ({
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: digests.map((d) => ({ digest: d })),
  })

  const singlePlatManifest: DockerManifest = {
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  }

  it('should process all manifests successfully with no retries', async () => {
    const getManifest = vi
      .fn()
      .mockResolvedValueOnce(multiPlatManifest(['sha256:aaa', 'sha256:bbb']))
      .mockResolvedValueOnce(singlePlatManifest)

    const images = [taggedVersion(1, 'v1'), taggedVersion(2, 'v2')]

    const digests = await processManifestsWithRetryQueue(getManifest, 3)(images)

    expect(digests).toEqual(['sha256:aaa', 'sha256:bbb'])
    expect(getManifest).toHaveBeenCalledTimes(2)
  })

  it('should skip untagged versions', async () => {
    const getManifest = vi
      .fn()
      .mockResolvedValue(multiPlatManifest(['sha256:aaa']))

    const images = [
      untaggedVersion(1),
      taggedVersion(2, 'v2'),
      untaggedVersion(3),
    ]

    const digests = await processManifestsWithRetryQueue(getManifest, 3)(images)

    expect(getManifest).toHaveBeenCalledTimes(1)
    expect(getManifest).toHaveBeenCalledWith('v2')
    expect(digests).toEqual(['sha256:aaa'])
  })

  it('should queue 404 failures and retry after processing others', async () => {
    const getManifest = vi
      .fn()
      // First pass: image1 404s, image2 succeeds
      .mockRejectedValueOnce(new Docker404Error('url1'))
      .mockResolvedValueOnce(multiPlatManifest(['sha256:bbb']))
      // Retry round 1: image1 succeeds
      .mockResolvedValueOnce(multiPlatManifest(['sha256:aaa']))

    const images = [taggedVersion(1, 'v1'), taggedVersion(2, 'v2')]

    const digests = await processManifestsWithRetryQueue(getManifest, 3)(images)

    expect(digests).toEqual(['sha256:bbb', 'sha256:aaa'])
    expect(getManifest).toHaveBeenCalledTimes(3)
  })

  it('should retry multiple rounds with backoff', async () => {
    const getManifest = vi
      .fn()
      // First pass: 404
      .mockRejectedValueOnce(new Docker404Error('url1'))
      // Retry round 1: still 404
      .mockRejectedValueOnce(new Docker404Error('url1'))
      // Retry round 2: succeeds
      .mockResolvedValueOnce(multiPlatManifest(['sha256:aaa']))

    const images = [taggedVersion(1, 'v1')]

    const digests = await processManifestsWithRetryQueue(getManifest, 5)(images)

    expect(digests).toEqual(['sha256:aaa'])
    expect(getManifest).toHaveBeenCalledTimes(3)
  })

  it('should throw when manifests still fail after all retry rounds', async () => {
    const getManifest = vi.fn().mockRejectedValue(new Docker404Error('url1'))

    const images = [taggedVersion(1, 'v1')]

    await expect(
      processManifestsWithRetryQueue(getManifest, 2)(images),
    ).rejects.toThrow('1 manifest(s) still returned 404 after 2 retry round(s)')

    // 1 first pass + 2 retry rounds = 3 calls
    expect(getManifest).toHaveBeenCalledTimes(3)
    expect(core.error).toHaveBeenCalledWith(
      '1 manifest(s) still returned 404 after 2 retry round(s)',
    )
  })

  it('should not retry on non-404 errors', async () => {
    const getManifest = vi.fn().mockRejectedValueOnce(new Error('Server error'))

    const images = [taggedVersion(1, 'v1')]

    await expect(
      processManifestsWithRetryQueue(getManifest, 3)(images),
    ).rejects.toThrow('Server error')
    expect(getManifest).toHaveBeenCalledTimes(1)
  })

  it('should work with maxRetries of 0 (no retries)', async () => {
    const getManifest = vi.fn().mockRejectedValue(new Docker404Error('url1'))

    const images = [taggedVersion(1, 'v1')]

    await expect(
      processManifestsWithRetryQueue(getManifest, 0)(images),
    ).rejects.toThrow('1 manifest(s) still returned 404 after 0 retry round(s)')

    // Only 1 call (first pass), no retries
    expect(getManifest).toHaveBeenCalledTimes(1)
    expect(core.error).toHaveBeenCalledWith(
      '1 manifest(s) still returned 404 after 0 retry round(s)',
    )
  })

  it('should handle mixed success and 404 in retry queue', async () => {
    const getManifest = vi
      .fn()
      // First pass: both 404
      .mockRejectedValueOnce(new Docker404Error('url1'))
      .mockRejectedValueOnce(new Docker404Error('url2'))
      // Retry round 1: image1 succeeds, image2 still 404
      .mockResolvedValueOnce(multiPlatManifest(['sha256:aaa']))
      .mockRejectedValueOnce(new Docker404Error('url2'))
      // Retry round 2: image2 succeeds
      .mockResolvedValueOnce(multiPlatManifest(['sha256:bbb']))

    const images = [taggedVersion(1, 'v1'), taggedVersion(2, 'v2')]

    const digests = await processManifestsWithRetryQueue(getManifest, 3)(images)

    expect(digests).toEqual(['sha256:aaa', 'sha256:bbb'])
    expect(getManifest).toHaveBeenCalledTimes(5)
  })

  it('should fall back to default maxRetries of 5 for invalid values', async () => {
    const getManifest = vi.fn().mockRejectedValue(new Docker404Error('url1'))

    const images = [taggedVersion(1, 'v1')]

    await expect(
      processManifestsWithRetryQueue(getManifest, NaN)(images),
    ).rejects.toThrow('1 manifest(s) still returned 404 after 5 retry round(s)')

    // 1 first pass + 5 default retry rounds = 6 calls
    expect(getManifest).toHaveBeenCalledTimes(6)
  })

  describe('ghost404Behavior: warn', () => {
    it('should warn and skip when manifests still 404 after retries', async () => {
      const getManifest = vi.fn().mockRejectedValue(new Docker404Error('url1'))

      const images = [taggedVersion(1, 'v1')]

      const digests = await processManifestsWithRetryQueue(
        getManifest,
        2,
        'warn',
      )(images)

      expect(digests).toEqual([])
      // 1 first pass + 2 retries = 3 calls
      expect(getManifest).toHaveBeenCalledTimes(3)
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining(
          '1 manifest(s) still returned 404 after 2 retry round(s)',
        ),
      )
    })

    it('should return partial digests and warn for remaining ghosts', async () => {
      const getManifest = vi
        .fn()
        // First pass: image1 succeeds, image2 404s
        .mockResolvedValueOnce(multiPlatManifest(['sha256:aaa']))
        .mockRejectedValueOnce(new Docker404Error('url2'))
        // Retry: image2 still 404
        .mockRejectedValueOnce(new Docker404Error('url2'))

      const images = [taggedVersion(1, 'v1'), taggedVersion(2, 'v2')]

      const digests = await processManifestsWithRetryQueue(
        getManifest,
        1,
        'warn',
      )(images)

      expect(digests).toEqual(['sha256:aaa'])
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('1 manifest(s) still returned 404'),
      )
    })
  })

  describe('ghost404Behavior: delete', () => {
    it('should delete ghost versions via provided delete function', async () => {
      const getManifest = vi.fn().mockRejectedValue(new Docker404Error('url1'))

      const deleteGhostVersion = vi.fn().mockResolvedValue(undefined)

      // listVersions returns empty (ghost successfully removed)
      const listVersions = vi.fn().mockResolvedValue({ data: [] })

      const images = [taggedVersion(1, 'v1')]

      const digests = await processManifestsWithRetryQueue(
        getManifest,
        1,
        'delete',
        deleteGhostVersion,
        listVersions,
      )(images)

      expect(digests).toEqual([])
      expect(deleteGhostVersion).toHaveBeenCalledTimes(1)
      expect(deleteGhostVersion).toHaveBeenCalledWith(images[0])
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleted ghost version id=1'),
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('confirmed removed'),
      )
    })

    it('should warn if ghost deletion fails', async () => {
      const getManifest = vi.fn().mockRejectedValue(new Docker404Error('url1'))

      const deleteGhostVersion = vi
        .fn()
        .mockRejectedValue(new Error('Permission denied'))

      const listVersions = vi.fn().mockResolvedValue({ data: [] })

      const images = [taggedVersion(1, 'v1')]

      const digests = await processManifestsWithRetryQueue(
        getManifest,
        1,
        'delete',
        deleteGhostVersion,
        listVersions,
      )(images)

      expect(digests).toEqual([])
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete ghost version id=1'),
      )
    })

    it('should warn if ghost versions still listed after deletion', async () => {
      const getManifest = vi.fn().mockRejectedValue(new Docker404Error('url1'))

      const deleteGhostVersion = vi.fn().mockResolvedValue(undefined)

      // Ghost is still listed after deletion
      const listVersions = vi.fn().mockResolvedValue({
        data: [taggedVersion(1, 'v1')],
      })

      const images = [taggedVersion(1, 'v1')]

      const digests = await processManifestsWithRetryQueue(
        getManifest,
        1,
        'delete',
        deleteGhostVersion,
        listVersions,
      )(images)

      expect(digests).toEqual([])
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining(
          '1 ghost version(s) still listed after deletion',
        ),
      )
    })

    it('should throw if delete function is not provided', async () => {
      const getManifest = vi.fn().mockRejectedValue(new Docker404Error('url1'))

      const images = [taggedVersion(1, 'v1')]

      await expect(
        processManifestsWithRetryQueue(getManifest, 1, 'delete')(images),
      ).rejects.toThrow(
        'ghcr-404-behavior is set to `delete` but no delete function was provided',
      )
    })

    it('should delete multiple ghost versions and validate', async () => {
      const getManifest = vi
        .fn()
        // First pass: both 404
        .mockRejectedValueOnce(new Docker404Error('url1'))
        .mockRejectedValueOnce(new Docker404Error('url2'))
        // Retry: both still 404
        .mockRejectedValueOnce(new Docker404Error('url1'))
        .mockRejectedValueOnce(new Docker404Error('url2'))

      const deleteGhostVersion = vi.fn().mockResolvedValue(undefined)

      const listVersions = vi.fn().mockResolvedValue({ data: [] })

      const images = [taggedVersion(1, 'v1'), taggedVersion(2, 'v2')]

      const digests = await processManifestsWithRetryQueue(
        getManifest,
        1,
        'delete',
        deleteGhostVersion,
        listVersions,
      )(images)

      expect(digests).toEqual([])
      expect(deleteGhostVersion).toHaveBeenCalledTimes(2)
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(
          'All 2 deleted ghost version(s) confirmed removed',
        ),
      )
    })
  })
})
