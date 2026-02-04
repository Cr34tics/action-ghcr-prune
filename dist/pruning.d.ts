import { ContainerVersion, DockerManifest } from './types'
type ListVersionsFn = (
  pageSize: number,
  page?: number,
) => Promise<
  | {
      data: ContainerVersion[]
    }
  | {
      data: unknown[]
    }
>
export declare const getAllMultiPlatList: (
  listVersions: ListVersionsFn,
  getManifest: (tag: string) => Promise<DockerManifest>,
) => () => Promise<string[]>
export declare const getMultiPlatPruningList: (
  listVersions: ListVersionsFn,
  getManifest: (tag: string) => Promise<DockerManifest>,
) => (
  pruningList: ContainerVersion[],
) => Promise<ContainerVersion[] | undefined>
export declare const getPruningList: (
  listVersions: ListVersionsFn,
  pruningFilter: (version: ContainerVersion) => boolean,
) => (keepLast?: number) => Promise<ContainerVersion[]>
export declare const prune: (
  pruneVersion: (version: ContainerVersion) => Promise<unknown>,
) => (pruningList: ContainerVersion[]) => Promise<ContainerVersion[]>
export {}
