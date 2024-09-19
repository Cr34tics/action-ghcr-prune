const core = require('@actions/core')
const { digestFilter } = require('./version-filter')

const PAGE_SIZE = 100

const sortByVersionCreationDesc = (first, second) =>
  -first.created_at.localeCompare(second.created_at)

const multiPlatImage = (manifest) => {
  if (manifest.manifests == undefined) {
    return false
  }
  return (
    manifest.mediaType == 'application/vnd.oci.image.index.v1+json' ||
    manifest.mediaType == 'application/vnd.docker.distribution.manifest.v2+json'
  )
}

const getAllMultiPlatList = (listVersions, getManifest) => async () => {
  const digests = []
  let allVersions = []
  let lastPageSize = 0
  let page = 1

  core.info('Crawling through all images for multi-platform images...')

  do {
    const { data: versions } = await listVersions(PAGE_SIZE, page)
    lastPageSize = versions.length
    allVersions = [...allVersions, ...versions]
    page++
  } while (lastPageSize >= PAGE_SIZE)

  for (const image of allVersions) {
    core.debug(`Checking image: ${JSON.stringify(image)}`)
    if (image.metadata.container.tags.length == 0) {
      //no tags, so continue
      continue
    }

    const manifest = await getManifest(image.metadata.container.tags[0])
    core.debug(`Manifest: ${JSON.stringify(manifest)}`)
    if (!multiPlatImage(manifest)) {
      //not a multi-plat image, so continue
      continue
    }

    for (const subImage of manifest.manifests) {
      core.info(`Found subimage: ${subImage.digest}`)
      digests.push(subImage.digest)
    }
  }

  return digests
}

const getMultiPlatPruningList =
  (listVersions, getManifest) => async (pruningList) => {
    core.info('Crawling through pruning list for multi-platform images...')

    const digests = []

    for (const image of pruningList) {
      core.debug(`Checking image: ${JSON.stringify(image)}`)
      const manifest = await getManifest(image.metadata.container.tags[0])
      core.debug(`Manifest: ${JSON.stringify(manifest)}`)
      if (!multiPlatImage(manifest)) {
        //not a multi-plat image, so continue
        continue
      }

      for (const subImage of manifest.manifests) {
        core.info(`Found subimage: ${subImage.digest}`)
        digests.push(subImage.digest)
      }
    }

    if (digests.length) {
      const filterByDigests = digestFilter(digests)
      /* keepLast can be 0 here as we already know we are pruning these versions */
      const newImagesToPrune = getPruningList(listVersions, filterByDigests)(0)

      return newImagesToPrune
    } else {
      return undefined
    }
  }

const getPruningList =
  (listVersions, pruningFilter) =>
  async (keepLast = 0) => {
    let pruningList = []
    let page = 1
    let lastPageSize = 0

    core.info('Crawling through all versions to build pruning list...')

    do {
      const { data: versions } = await listVersions(PAGE_SIZE, page)
      lastPageSize = versions.length

      const pagePruningList = versions.filter(pruningFilter)
      pruningList = [...pruningList, ...pagePruningList]

      core.info(
        `Found ${pagePruningList.length} versions to prune out of ${lastPageSize} on page ${page}`,
      )

      page++
    } while (lastPageSize >= PAGE_SIZE)

    if (keepLast > 0) {
      core.info(
        `Keeping the last ${keepLast} versions, sorted by creation date`,
      )
      return pruningList.sort(sortByVersionCreationDesc).slice(keepLast)
    }

    return pruningList
  }

const prune = (pruneVersion) => async (pruningList) => {
  const pruned = []
  try {
    core.startGroup(`Pruning ${pruningList.length} versions...`)

    for (const version of pruningList) {
      core.info(`Pruning version #${version.id} named '${version.name}'...`)
      await pruneVersion(version)
      pruned.push(version)
    }

    core.endGroup()
  } catch (error) {
    core.endGroup()
    core.error(`Failed to prune because of: ${error}`)
  }

  core.notice(`Pruned ${pruned.length} versions`)

  return pruned
}

module.exports = {
  getAllMultiPlatList,
  getMultiPlatPruningList,
  getPruningList,
  prune,
}
