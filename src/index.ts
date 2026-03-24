import * as core from '@actions/core'
import * as github from '@actions/github'
import {
  deleteAuthenticatedUserContainerVersion,
  deleteOrgContainerVersion,
  deleteUserContainerVersion,
  listAuthenticatedUserContainerVersions,
  listOrgContainerVersions,
  listUserContainerVersions,
} from './octokit'
import {
  getAllMultiPlatList,
  getMultiPlatPruningList,
  getPruningList,
  prune,
} from './pruning'
import { versionFilter } from './version-filter'
import { getManifest, createDockerAPIClient, dockerAPIGet } from './docker-api'
import type { ContainerVersion } from './types'

const asBoolean = (v: string): boolean => 'true' === v

const versionSummary = (version: ContainerVersion): string =>
  JSON.stringify({
    id: version.id,
    name: version.name,
    created_at: version.created_at,
    tags: version.metadata.container.tags,
  })

const dryRunDelete = (version: ContainerVersion): Promise<void> =>
  new Promise((resolve) => {
    core.info(`Dry-run pruning of: ${versionSummary(version)}`)
    resolve()
  })

const writeSummary = async (
  container: string,
  dryRun: boolean,
  pruningVersions: ContainerVersion[],
  prunedVersions: ContainerVersion[],
): Promise<void> => {
  const allPruned = pruningVersions.length === prunedVersions.length

  let summary = core.summary.addHeading(
    `Pruning versions for container: ${container}`,
    2,
  )

  if (dryRun) {
    summary = summary.addRaw(
      ':warning: This is a dry run, no container versions were actually deleted.',
    )
  } else {
    summary = summary.addRaw(
      `${allPruned ? ':white_check_mark:' : ':x:'} ${String(
        prunedVersions.length,
      )} out of ${String(
        pruningVersions.length,
      )} identified versions were pruned successfully.`,
    )
  }

  await summary
    .addHeading('Pruned versions', 3)
    .addRaw(
      `The following ${String(prunedVersions.length)} versions were successfully pruned:`,
    )
    .addTable([
      [
        { data: 'ID', header: true },
        { data: 'Name', header: true },
        { data: 'Created at', header: true },
        { data: 'Tags', header: true },
      ],
      ...prunedVersions.map((version) => [
        String(version.id),
        version.name,
        version.created_at.replace('T', ' '),
        version.metadata.container.tags.join(', '),
      ]),
    ])
    .write()
}

const run = async (): Promise<void> => {
  try {
    const token = core.getInput('token')
    const organization = core.getInput('organization')
    const user = core.getInput('user')

    if (organization && user) {
      core.setFailed(
        'Inputs `organization` and `user` are mutually exclusive and must not both be provided in the same run.',
      )
      return
    }

    const container = core.getInput('container')
    core.debug(`Container: ${container}`)

    const removeMultiPlatform = asBoolean(
      core.getInput('remove-multi-platform'),
    )

    const dryRun = asBoolean(core.getInput('dry-run'))

    const keepLast = Number(core.getInput('keep-last'))

    const pruneUntagged = asBoolean(core.getInput('prune-untagged'))

    const ghcrMaxRetries = Number(core.getInput('ghcr-max-retries'))

    if (
      !Number.isFinite(ghcrMaxRetries) ||
      !Number.isInteger(ghcrMaxRetries) ||
      ghcrMaxRetries < 0
    ) {
      core.setFailed(
        'Input `ghcr-max-retries` must be a non-negative integer (0 or greater).',
      )
      return
    }

    if (removeMultiPlatform && pruneUntagged) {
      core.setFailed(
        'Inputs `remove-multi-platform` and `prune-untagged` are mutually exclusive and must not both be provided in the same run.',
      )
      return
    }

    /* This can possibly be improved. We need this info for multi-platform due
       to the docker registry api, but we might be able to autodetect this from
       the authenticated user */
    if (removeMultiPlatform && !(organization || user)) {
      core.setFailed(
        'Inputs `remove-multi-platform` requires either `organization` or `user` to defined',
      )
      return
    }

    const filterOptions = {
      keepTags: core.getMultilineInput('keep-tags'),
      keepTagsRegexes: core.getMultilineInput('keep-tags-regexes'),
      keepYoungerThan: Number(core.getInput('keep-younger-than')),
      pruneTagsRegexes: core.getMultilineInput('prune-tags-regexes'),
      pruneUntagged: pruneUntagged,
    }

    core.debug(`Filter options: ${JSON.stringify(filterOptions)}`)

    const octokit = github.getOctokit(token)

    let listVersions
    let pruneVersion
    let owner: string | undefined
    if (user) {
      listVersions = listUserContainerVersions(octokit)(user, container)
      pruneVersion = dryRun
        ? dryRunDelete
        : deleteUserContainerVersion(octokit)(user, container)
      owner = user
    } else if (organization) {
      listVersions = listOrgContainerVersions(octokit)(organization, container)
      pruneVersion = dryRun
        ? dryRunDelete
        : deleteOrgContainerVersion(octokit)(organization, container)
      owner = organization
    } else {
      listVersions = listAuthenticatedUserContainerVersions(octokit)(container)
      pruneVersion = dryRun
        ? dryRunDelete
        : deleteAuthenticatedUserContainerVersion(octokit)(container)
    }
    const filterVersion = versionFilter(filterOptions)

    const pruningList = await getPruningList(
      listVersions,
      filterVersion,
    )(keepLast)

    if (removeMultiPlatform) {
      const dockerAPIClient = createDockerAPIClient()
      const dockerAPIGetCmd = dockerAPIGet(
        dockerAPIClient,
        token,
        owner ?? '',
        container,
        ghcrMaxRetries,
      )
      const getManifestByTag = getManifest(dockerAPIGetCmd)

      const multiPlatPruningList = await getMultiPlatPruningList(
        listVersions,
        getManifestByTag,
      )(pruningList)

      if (multiPlatPruningList) {
        pruningList.push(...multiPlatPruningList)
      }
    } else if (pruneUntagged) {
      const dockerAPIClient = createDockerAPIClient()
      const dockerAPIGetCmd = dockerAPIGet(
        dockerAPIClient,
        token,
        owner ?? '',
        container,
        ghcrMaxRetries,
      )
      const getManifestByTag = getManifest(dockerAPIGetCmd)

      const digests = await getAllMultiPlatList(
        listVersions,
        getManifestByTag,
      )()

      console.log(
        `Identified ${String(digests.length)} untagged images that are a part of a tagged multi-arch image`,
      )

      for (let i = pruningList.length - 1; i >= 0; i--) {
        const image = pruningList[i]

        if (digests.includes(image.name)) {
          pruningList.splice(i, 1)
        }
      }
    }

    core.info(
      `Found a total of ${String(pruningList.length)} versions to prune`,
    )

    const prunedList = await prune(pruneVersion)(pruningList)

    await writeSummary(container, dryRun, pruningList, prunedList)

    if (prunedList.length !== pruningList.length) {
      core.setFailed(
        `Failed to prune some versions: ${String(prunedList.length)} out of ${String(pruningList.length)} versions were pruned`,
      )
    }

    core.setOutput('count', prunedList.length)
    core.setOutput(
      'prunedVersionIds',
      prunedList.map((version) => version.id),
    )
    core.setOutput('dryRun', dryRun)
  } catch (error: unknown) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed(String(error))
    }
  }
}

run().catch((error: unknown) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
