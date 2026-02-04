import { ContainerVersion, FilterOptions } from './types'
export declare const versionFilter: (
  options: FilterOptions,
) => (version: ContainerVersion) => boolean
export declare const digestFilter: (
  digests: string[],
) => (version: ContainerVersion) => boolean
