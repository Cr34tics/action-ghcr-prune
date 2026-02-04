import { type getOctokit } from '@actions/github'
import type { ContainerVersion } from './types'

type Octokit = ReturnType<typeof getOctokit>

export const deleteAuthenticatedUserContainerVersion =
  (octokit: Octokit) =>
  (container: string) =>
  (version: ContainerVersion): ReturnType<
    Octokit['rest']['packages']['deletePackageVersionForAuthenticatedUser']
  > =>
    octokit.rest.packages.deletePackageVersionForAuthenticatedUser({
      package_type: 'container',
      package_name: container,
      package_version_id: version.id,
    })

export const deleteOrgContainerVersion =
  (octokit: Octokit) =>
  (organization: string, container: string) =>
  (version: ContainerVersion): ReturnType<
    Octokit['rest']['packages']['deletePackageVersionForOrg']
  > =>
    octokit.rest.packages.deletePackageVersionForOrg({
      package_type: 'container',
      org: organization,
      package_name: container,
      package_version_id: version.id,
    })

export const deleteUserContainerVersion =
  (octokit: Octokit) =>
  (user: string, container: string) =>
  (version: ContainerVersion): ReturnType<
    Octokit['rest']['packages']['deletePackageVersionForUser']
  > =>
    octokit.rest.packages.deletePackageVersionForUser({
      package_type: 'container',
      username: user,
      package_name: container,
      package_version_id: version.id,
    })

export const listAuthenticatedUserContainerVersions =
  (octokit: Octokit) =>
  (container: string) =>
  (pageSize: number, page = 1): ReturnType<
    Octokit['rest']['packages']['getAllPackageVersionsForPackageOwnedByAuthenticatedUser']
  > =>
    octokit.rest.packages.getAllPackageVersionsForPackageOwnedByAuthenticatedUser(
      {
        package_type: 'container',
        package_name: container,
        page,
        per_page: pageSize,
        state: 'active',
      },
    )

export const listOrgContainerVersions =
  (octokit: Octokit) =>
  (organization: string, container: string) =>
  (pageSize: number, page = 1): ReturnType<
    Octokit['rest']['packages']['getAllPackageVersionsForPackageOwnedByOrg']
  > =>
    octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg({
      package_type: 'container',
      org: organization,
      package_name: container,
      page,
      per_page: pageSize,
      state: 'active',
    })

export const listUserContainerVersions =
  (octokit: Octokit) =>
  (user: string, container: string) =>
  (pageSize: number, page = 1): ReturnType<
    Octokit['rest']['packages']['getAllPackageVersionsForPackageOwnedByUser']
  > =>
    octokit.rest.packages.getAllPackageVersionsForPackageOwnedByUser({
      package_type: 'container',
      username: user,
      package_name: container,
      page,
      per_page: pageSize,
      state: 'active',
    })
