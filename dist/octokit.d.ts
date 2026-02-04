import { getOctokit } from '@actions/github'
import { ContainerVersion } from './types'
type Octokit = ReturnType<typeof getOctokit>
export declare const deleteAuthenticatedUserContainerVersion: (
  octokit: Octokit,
) => (
  container: string,
) => (
  version: ContainerVersion,
) => Promise<
  import('@octokit/plugin-paginate-rest/dist-types/types').OctokitResponse<
    never,
    204
  >
>
export declare const deleteOrgContainerVersion: (
  octokit: Octokit,
) => (
  organization: string,
  container: string,
) => (
  version: ContainerVersion,
) => Promise<
  import('@octokit/plugin-paginate-rest/dist-types/types').OctokitResponse<
    never,
    204
  >
>
export declare const deleteUserContainerVersion: (
  octokit: Octokit,
) => (
  user: string,
  container: string,
) => (
  version: ContainerVersion,
) => Promise<
  import('@octokit/plugin-paginate-rest/dist-types/types').OctokitResponse<
    never,
    204
  >
>
export declare const listAuthenticatedUserContainerVersions: (
  octokit: Octokit,
) => (container: string) => (
  pageSize: number,
  page?: number,
) => Promise<
  import('@octokit/plugin-paginate-rest/dist-types/types').OctokitResponse<
    {
      id: number
      name: string
      url: string
      package_html_url: string
      html_url?: string
      license?: string
      description?: string
      created_at: string
      updated_at: string
      deleted_at?: string
      metadata?: {
        package_type:
          | 'npm'
          | 'maven'
          | 'rubygems'
          | 'docker'
          | 'nuget'
          | 'container'
        container?: {
          tags: string[]
        }
        docker?: {
          tag?: string[]
        }
      }
    }[],
    200
  >
>
export declare const listOrgContainerVersions: (octokit: Octokit) => (
  organization: string,
  container: string,
) => (
  pageSize: number,
  page?: number,
) => Promise<
  import('@octokit/plugin-paginate-rest/dist-types/types').OctokitResponse<
    {
      id: number
      name: string
      url: string
      package_html_url: string
      html_url?: string
      license?: string
      description?: string
      created_at: string
      updated_at: string
      deleted_at?: string
      metadata?: {
        package_type:
          | 'npm'
          | 'maven'
          | 'rubygems'
          | 'docker'
          | 'nuget'
          | 'container'
        container?: {
          tags: string[]
        }
        docker?: {
          tag?: string[]
        }
      }
    }[],
    200
  >
>
export declare const listUserContainerVersions: (octokit: Octokit) => (
  user: string,
  container: string,
) => (
  pageSize: number,
  page?: number,
) => Promise<
  import('@octokit/plugin-paginate-rest/dist-types/types').OctokitResponse<
    {
      id: number
      name: string
      url: string
      package_html_url: string
      html_url?: string
      license?: string
      description?: string
      created_at: string
      updated_at: string
      deleted_at?: string
      metadata?: {
        package_type:
          | 'npm'
          | 'maven'
          | 'rubygems'
          | 'docker'
          | 'nuget'
          | 'container'
        container?: {
          tags: string[]
        }
        docker?: {
          tag?: string[]
        }
      }
    }[],
    200
  >
>
export {}
