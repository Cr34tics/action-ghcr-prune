import * as core from '@actions/core'
import type { ContainerVersion, DockerManifest } from './types'
import { digestFilter } from './version-filter'

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

type ListVersionsFn = (
  pageSize: number,
  page?: number,
) => Promise<{ data: ContainerVersion[] } | { data: unknown[] }>

export const getAllMultiPlatList =
  (
    listVersions: ListVersionsFn,
    getManifest: (tag: string) => Promise<DockerManifest>,
  ) =>
  async (): Promise<string[]> => {
    const digests: string[] = []
    let allVersions: ContainerVersion[] = []
    let lastPageSize = 0
    let page = 1

    core.info('Crawling through all images for multi-platform images...')

    do {
      const { data: versions } = await listVersions(PAGE_SIZE, page)
      lastPageSize = versions.length
      allVersions = [...allVersions, ...versions] as ContainerVersion[]
      page++
    } while (lastPageSize >= PAGE_SIZE)

    for (const image of allVersions) {
      if (image.metadata.container.tags.length == 0) {
        //no tags, so continue
        continue
      }

      const manifest = await getManifest(image.metadata.container.tags[0])
      if (!multiPlatImage(manifest)) {
        //not a multi-plat image, so continue
        continue
      }

      if (manifest.manifests) {
        for (const subImage of manifest.manifests) {
          core.info(`Found subimage: ${subImage.digest}`)
          digests.push(subImage.digest)
        }
      }
    }

    return digests
  }

export const getMultiPlatPruningList =
  (
    listVersions: ListVersionsFn,
    getManifest: (tag: string) => Promise<DockerManifest>,
  ) =>
  async (
    pruningList: ContainerVersion[],
  ): Promise<ContainerVersion[] | undefined> => {
    core.info('Crawling through pruning list for multi-platform images...')

    const digests: string[] = []

    for (const image of pruningList) {
      const manifest = await getManifest(image.metadata.container.tags[0])
      if (!multiPlatImage(manifest)) {
        //not a multi-plat image, so continue
        continue
      }

      if (manifest.manifests) {
        for (const subImage of manifest.manifests) {
          core.info(`Found subimage: ${subImage.digest}`)
          digests.push(subImage.digest)
        }
      }
    }

    if (digests.length) {
      const filterByDigests = digestFilter(digests)
      /* keepLast can be 0 here as we already know we are pruning these versions */
      const newImagesToPrune = await getPruningList(
        listVersions,
        filterByDigests,
      )(0)

      return newImagesToPrune
    } else {
      return undefined
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
    let lastPageSize = 0

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
