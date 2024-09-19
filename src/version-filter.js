const core = require('@actions/core')

const MS_IN_DAY = 1000 * 60 * 60 * 24

const daysBetween = (startDate, endDate = new Date()) =>
  Math.floor((endDate.getTime() - startDate.getTime()) / MS_IN_DAY)

const anyRegexMatch = (regexes) => (tags) =>
  regexes.some((regex) => tags.some((tag) => tag.match(regex)))

const debugLog = (message, version, age) => {
  core.debug(
    `Version: ${JSON.stringify(
      {
        id: version.id,
        name: version.name,
        tags: version.metadata.container.tags,
        age,
        message,
      },
      null,
      2,
    )}`,
  )
}

const versionFilter = (options) => (version) => {
  const {
    keepTags,
    keepTagsRegexes,
    keepYoungerThan,
    pruneTagsRegexes,
    pruneUntagged,
  } = options
  const createdAt = new Date(version.created_at)
  const age = daysBetween(createdAt)

  const log = (message) => debugLog(message, version, age)

  if (keepYoungerThan > age) {
    log(
      `Keeping version ${version.name} because it is younger than ${keepYoungerThan} days`,
    )
    return false
  }

  const tags = version.metadata.container.tags

  if (pruneUntagged && (!tags || !tags.length)) {
    log(`Pruning version ${version.name} because it is unTagged`)
    return true
  }

  if (keepTags && tags && keepTags.some((keepTag) => tags.includes(keepTag))) {
    log(`Keeping version ${version.name} because it has a keep tag`)
    return false
  }

  if (keepTagsRegexes && tags && anyRegexMatch(keepTagsRegexes)(tags)) {
    log(`Keeping version ${version.name} because it matches a keep regex`)
    return false
  }

  if (pruneTagsRegexes && tags && anyRegexMatch(pruneTagsRegexes)(tags)) {
    log(`Pruning version ${version.name} because it matches a prune regex`)
    return true
  }

  log(`Keeping version ${version.name} because it did not match any filter`)
  return false
}

const digestFilter = (digests) => (version) => {
  const found = digests.find((digest) => version.name == digest)

  if (found) {
    return true
  } else {
    return false
  }
}

module.exports = {
  versionFilter,
  digestFilter,
}
