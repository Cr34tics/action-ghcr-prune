import * as core from '@actions/core'
import { HttpClient, type HttpClientResponse } from '@actions/http-client'
import { Buffer } from 'buffer'
import type { DockerManifest } from './types'

interface DockerAPIResponse {
  success: boolean
  code?: number
  message?: string
  resp?: HttpClientResponse
}

export const createDockerAPIClient = (): HttpClient => {
  const client = new HttpClient('github-action')

  return client
}

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const getBackoffMs = (attempt: number): number =>
  Math.min(1000 * Math.pow(2, attempt), 30000)

const dockerManifestV1 =
  (client: HttpClient, token: string, url: string) =>
  async (_resource: string): Promise<DockerAPIResponse> => {
    const headers = {
      Accept: `application/vnd.oci.image.index.v1+json`,
      Authorization: `Bearer ${token}`,
    }

    const response = await client.get(url, headers)

    if (response.message.statusCode !== 200) {
      return {
        success: false,
        code: response.message.statusCode,
        message: response.message.statusMessage,
      }
    }

    return { success: true, resp: response }
  }

const dockerManifestV2 =
  (client: HttpClient, token: string, url: string) =>
  async (_resource: string): Promise<DockerAPIResponse> => {
    const headers = {
      Accept: `application/vnd.docker.distribution.manifest.v2+json`,
      Authorization: `Bearer ${token}`,
    }

    const response = await client.get(url, headers)

    if (response.message.statusCode !== 200) {
      return {
        success: false,
        code: response.message.statusCode,
        message: response.message.statusMessage,
      }
    }

    return { success: true, resp: response }
  }

export const dockerAPIGet =
  (
    client: HttpClient,
    token: string,
    owner: string,
    container: string,
    maxRetries = 10,
  ) =>
  async (resource: string): Promise<HttpClientResponse> => {
    const base64Token = Buffer.from(token).toString('base64')
    const url = `https://ghcr.io/v2/${owner}/${container}/${resource}`

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const responseV1 = await dockerManifestV1(
        client,
        base64Token,
        url,
      )(resource)
      const responseV2 = await dockerManifestV2(
        client,
        base64Token,
        url,
      )(resource)

      if (responseV1.success && responseV1.resp) {
        return responseV1.resp
      } else if (responseV2.success && responseV2.resp) {
        return responseV2.resp
      }

      const is404 = responseV1.code === 404 || responseV2.code === 404

      if (is404 && attempt < maxRetries) {
        const backoffMs = getBackoffMs(attempt)
        core.info(
          `Got 404 for ${url}, retrying in ${String(backoffMs)}ms (attempt ${String(attempt + 1)}/${String(maxRetries)})...`,
        )
        await delay(backoffMs)
        continue
      }

      throw new Error(
        `All Docker API requests at ${url} were unsuccessful. Docker manifest v1 status code ${String(responseV1.code)} (${String(responseV1.message)}). Docker manifest v2 status code ${String(responseV2.code)} (${String(responseV2.message)}).`,
      )
    }

    /* istanbul ignore next -- unreachable after loop */
    throw new Error(`Unexpected error after ${String(maxRetries)} retries`)
  }

export const getManifest =
  (getCmd: (resource: string) => Promise<HttpClientResponse>) =>
  async (tag: string): Promise<DockerManifest> => {
    const response = await getCmd(`manifests/${tag}`)

    const responseBody = await response.readBody()

    const manifest = JSON.parse(responseBody) as DockerManifest

    return manifest
  }
