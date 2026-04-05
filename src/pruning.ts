import * as core from '@actions/core'
import type { ContainerVersion, DockerManifest, Ghcr404Behavior } from './types'
import { digestFilter } from './version-filter'
import { Docker404Error, delay, getBackoffMs } from './docker-api'

const PAGE_SIZE = 100

const sortByVersionCreationDesc = (
  first: ContainerVersion,
  second: ContainerVersion,
): number => -first.created_at.localeCompare(second.created_at)

const multiPlatImage = (manifest: DockerManifest): boolean => {
  if (manifest.manifests == undefined) {
    return false
  }
  return (
    manifest.mediaType === 'application/vnd.oci.image.index.v1+json' ||
    manifest.mediaType ===
      'application/vnd.docker.distribution.manifest.v2+json'
  )
}

const collectDigests = (manifest: DockerManifest): string[] => {
  const digests: string[] = []
  if (multiPlatImage(manifest) && manifest.manifests) {
    for (const subImage of manifest.manifests) {
      core.info(`Found subimage: ${subImage.digest}`)
      digests.push(subImage.digest)
    }
  }
  return digests
}

export interface ManifestProcessingResult {
  digests: string[]
  deletedGhostIds: number[]
}

export const processManifestsWithRetryQueue =
  (
    getManifest: (tag: string) => Promise<DockerManifest>,
    maxRetries: number,
    ghost404Behavior: Ghcr404Behavior = 'fail',
    deleteGhostVersion?: (version: ContainerVersion) => Promise<unknown>,
    listVersions?: ListVersionsFn,
    deletableIds?: Set<number>,
  ) =>
  async (images: ContainerVersion[]): Promise<ManifestProcessingResult> => {
    const safeMaxRetries =
      Number.isFinite(maxRetries) &&
      Number.isInteger(maxRetries) &&
      maxRetries >= 0
        ? maxRetries
        : 5

    const allDigests: string[] = []
    let retryQueue: ContainerVersion[] = []

    // First pass: process all images, queue 404 failures
    for (const image of images) {
      const tags = image.metadata.container.tags
      if (tags.length === 0) {
        continue
      }

      try {
        const manifest = await getManifest(tags[0])
        allDigests.push(...collectDigests(manifest))
      } catch (error) {
        if (error instanceof Docker404Error) {
          retryQueue.push(image)
        } else {
          throw error
        }
      }
    }

    // Retry rounds: process queued 404 failures with backoff between rounds
    for (
      let round = 0;
      round < safeMaxRetries && retryQueue.length > 0;
      round++
    ) {
      const backoffMs = getBackoffMs(round)
      core.info(
        `Retry round ${String(round + 1)}/${String(safeMaxRetries)}: ${String(retryQueue.length)} manifest(s) in queue, waiting ${String(backoffMs)}ms...`,
      )
      await delay(backoffMs)

      const nextQueue: ContainerVersion[] = []
      for (const image of retryQueue) {
        try {
          const manifest = await getManifest(image.metadata.container.tags[0])
          allDigests.push(...collectDigests(manifest))
        } catch (error) {
          if (error instanceof Docker404Error) {
            nextQueue.push(image)
          } else {
            throw error
          }
        }
      }
      retryQueue = nextQueue
    }

    if (retryQueue.length > 0) {
      if (ghost404Behavior === 'warn') {
        const ghostSummary = retryQueue
          .map(
            (v) =>
              `id=${String(v.id)} tags=[${v.metadata.container.tags.join(', ')}]`,
          )
          .join('; ')
        core.warning(
          `${String(retryQueue.length)} manifest(s) still returned 404 after ${String(safeMaxRetries)} retry round(s). Treating as ghost version(s) and skipping: ${ghostSummary}`,
        )
      } else if (ghost404Behavior === 'delete') {
        const ghostSummary = retryQueue
          .map(
            (v) =>
              `id=${String(v.id)} tags=[${v.metadata.container.tags.join(', ')}]`,
          )
          .join('; ')
        core.warning(
          `${String(retryQueue.length)} ghost version(s) detected after ${String(safeMaxRetries)} retry round(s): ${ghostSummary}. Attempting to delete via Packages API...`,
        )

        if (!deleteGhostVersion) {
          throw new Error(
            'ghcr-404-behavior is set to `delete` but no delete function was provided',
          )
        }

        // When deletableIds is provided, only delete ghosts that are in the pruning set
        const deletableGhosts = deletableIds
          ? retryQueue.filter((g) => deletableIds.has(g.id))
          : retryQueue
        const skippedGhosts = deletableIds
          ? retryQueue.filter((g) => !deletableIds.has(g.id))
          : []

        if (skippedGhosts.length > 0) {
          const skippedSummary = skippedGhosts
            .map(
              (v) =>
                `id=${String(v.id)} tags=[${v.metadata.container.tags.join(', ')}]`,
            )
            .join('; ')
          core.warning(
            `${String(skippedGhosts.length)} ghost version(s) not in pruning set, skipping deletion: ${skippedSummary}`,
          )
        }

        const deletedIds: number[] = []
        for (const ghost of deletableGhosts) {
          try {
            await deleteGhostVersion(ghost)
            deletedIds.push(ghost.id)
            core.info(
              `Deleted ghost version id=${String(ghost.id)} tags=[${ghost.metadata.container.tags.join(', ')}]`,
            )
          } catch (error) {
            core.warning(
              `Failed to delete ghost version id=${String(ghost.id)}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }

        if (deletedIds.length > 0 && listVersions) {
          core.info(
            'Validating ghost versions are no longer listed after deletion...',
          )
          try {
            const remainingGhostIds = await validateGhostsDeleted(
              listVersions,
              deletedIds,
            )

            if (remainingGhostIds.length > 0) {
              core.warning(
                `${String(remainingGhostIds.length)} ghost version(s) still listed after deletion: ${remainingGhostIds.map(String).join(', ')}`,
              )
            } else {
              core.info(
                `All ${String(deletedIds.length)} deleted ghost version(s) confirmed removed.`,
              )
            }
          } catch (error) {
            core.warning(
              `Unable to validate deleted ghost version(s) due to a transient error: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }

        return { digests: allDigests, deletedGhostIds: deletedIds }
      } else {
        const message = `${String(retryQueue.length)} manifest(s) still returned 404 after ${String(safeMaxRetries)} retry round(s)`
        core.error(message)
        throw new Error(message)
      }
    }

    return { digests: allDigests, deletedGhostIds: [] }
  }

const validateGhostsDeleted = async (
  listVersions: ListVersionsFn,
  ghostIds: number[],
): Promise<number[]> => {
  const ghostIdSet = new Set(ghostIds)
  const remainingGhosts: number[] = []
  let page = 1
  let lastPageSize

  do {
    const { data: versions } = await listVersions(PAGE_SIZE, page)
    lastPageSize = versions.length
    for (const version of versions as ContainerVersion[]) {
      if (ghostIdSet.has(version.id)) {
        remainingGhosts.push(version.id)
        ghostIdSet.delete(version.id)
      }
    }
    page++
  } while (lastPageSize >= PAGE_SIZE && ghostIdSet.size > 0)

  return remainingGhosts
}

type ListVersionsFn = (
  pageSize: number,
  page?: number,
) => Promise<{ data: ContainerVersion[] } | { data: unknown[] }>

export const getAllMultiPlatList =
  (
    listVersions: ListVersionsFn,
    getManifest: (tag: string) => Promise<DockerManifest>,
    maxRetries = 5,
    ghost404Behavior: Ghcr404Behavior = 'fail',
    deleteGhostVersion?: (version: ContainerVersion) => Promise<unknown>,
    deletableIds?: Set<number>,
  ) =>
  async (): Promise<ManifestProcessingResult> => {
    let allVersions: ContainerVersion[] = []
    let lastPageSize
    let page = 1

    core.info('Crawling through all images for multi-platform images...')

    do {
      const { data: versions } = await listVersions(PAGE_SIZE, page)
      lastPageSize = versions.length
      allVersions = [...allVersions, ...versions] as ContainerVersion[]
      page++
    } while (lastPageSize >= PAGE_SIZE)

    return processManifestsWithRetryQueue(
      getManifest,
      maxRetries,
      ghost404Behavior,
      deleteGhostVersion,
      listVersions,
      deletableIds,
    )(allVersions)
  }

export interface MultiPlatPruningResult {
  versions?: ContainerVersion[]
  deletedGhostIds: number[]
}

export const getMultiPlatPruningList =
  (
    listVersions: ListVersionsFn,
    getManifest: (tag: string) => Promise<DockerManifest>,
    maxRetries = 5,
    ghost404Behavior: Ghcr404Behavior = 'fail',
    deleteGhostVersion?: (version: ContainerVersion) => Promise<unknown>,
  ) =>
  async (pruningList: ContainerVersion[]): Promise<MultiPlatPruningResult> => {
    core.info('Crawling through pruning list for multi-platform images...')

    const result = await processManifestsWithRetryQueue(
      getManifest,
      maxRetries,
      ghost404Behavior,
      deleteGhostVersion,
      listVersions,
    )(pruningList)

    if (result.digests.length) {
      const filterByDigests = digestFilter(result.digests)
      /* keepLast can be 0 here as we already know we are pruning these versions */
      const newImagesToPrune = await getPruningList(
        listVersions,
        filterByDigests,
      )(0)

      return {
        versions: newImagesToPrune,
        deletedGhostIds: result.deletedGhostIds,
      }
    } else {
      return { versions: undefined, deletedGhostIds: result.deletedGhostIds }
    }
  }

export const getPruningList =
  (
    listVersions: ListVersionsFn,
    pruningFilter: (version: ContainerVersion) => boolean,
  ) =>
  async (keepLast = 0): Promise<ContainerVersion[]> => {
    let pruningList: ContainerVersion[] = []
    let page = 1
    let lastPageSize

    core.info('Crawling through all versions to build pruning list...')

    do {
      const { data: versions } = await listVersions(PAGE_SIZE, page)
      lastPageSize = versions.length

      const pagePruningList = (versions as ContainerVersion[]).filter(
        pruningFilter,
      )
      pruningList = [...pruningList, ...pagePruningList]

      core.info(
        `Found ${String(pagePruningList.length)} versions to prune out of ${String(lastPageSize)} on page ${String(page)}`,
      )

      page++
    } while (lastPageSize >= PAGE_SIZE)

    if (keepLast > 0) {
      core.info(
        `Keeping the last ${String(keepLast)} versions, sorted by creation date`,
      )
      return pruningList.sort(sortByVersionCreationDesc).slice(keepLast)
    }

    return pruningList
  }

export const prune =
  (pruneVersion: (version: ContainerVersion) => Promise<unknown>) =>
  async (pruningList: ContainerVersion[]): Promise<ContainerVersion[]> => {
    const pruned: ContainerVersion[] = []
    core.startGroup(`Pruning ${String(pruningList.length)} versions...`)

    for (const version of pruningList) {
      core.info(
        `Pruning version #${String(version.id)} named '${version.name}' tags: ${version.metadata.container.tags.join(', ')}...`,
      )
      try {
        await pruneVersion(version)
        pruned.push(version)
      } catch (error) {
        core.debug(
          `Failed to prune version: ${JSON.stringify(version, null, 2)}`,
        )
        core.error(
          `Failed to prune because of: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    core.endGroup()

    core.notice(`Pruned ${String(pruned.length)} versions`)

    return pruned
  }
