export interface ContainerVersion {
  id: number
  name: string
  created_at: string
  metadata: {
    container: {
      tags: string[]
    }
  }
}

export interface FilterOptions {
  keepTags?: string[]
  keepTagsRegexes?: string[]
  keepYoungerThan?: number
  pruneTagsRegexes?: string[] | null
  pruneUntagged?: boolean
}

export interface DockerManifest {
  manifests?: {
    digest: string
    platform?: {
      architecture: string
      os: string
    }
  }[]
  mediaType?: string
}

export interface APIResponse {
  success: boolean
  code?: number
  message?: string
  resp?: unknown
}

export type Ghcr404Behavior = 'fail' | 'warn' | 'delete'
