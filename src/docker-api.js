const http = require('@actions/http-client')
const { Buffer } = require('buffer')

const createDockerAPIClient = () => {
  const client = new http.HttpClient('github-action')

  return client
}

const dockerManifestV1 = (client, token, url) => async (resource) => {
  const headers = {
    Accept: `application/vnd.oci.image.index.v1+json`,
    Authorization: `Bearer ${token}`,
  }

  const response = await client.get(url, headers)

  if (response.message.statusCode != 200) {
    return {
      success: false,
      code: response.message.statusCode,
      message: response.message.statusMessage,
    }
  }

  return { success: true, resp: response }
}

const dockerManifestV2 = (client, token, url) => async (resource) => {
  const headers = {
    Accept: `application/vnd.docker.distribution.manifest.v2+json`,
    Authorization: `Bearer ${token}`,
  }

  const response = await client.get(url, headers)

  if (response.message.statusCode != 200) {
    return {
      success: false,
      code: response.message.statusCode,
      message: response.message.statusMessage,
    }
  }

  return { success: true, resp: response }
}

const dockerAPIGet = (client, token, owner, container) => async (resource) => {
  const base64Token = Buffer.from(token).toString('base64')
  const url = `https://ghcr.io/v2/${owner}/${container}/${resource}`
  responseV1 = await dockerManifestV1(client, base64Token, url)(resource)
  responseV2 = await dockerManifestV2(client, base64Token, url)(resource)

  if (responseV1['success']) {
    return responseV1['resp']
  } else if (responseV2['success']) {
    return responseV2['resp']
  } else {
    throw new Error(
      `All Docker API requests at ${url} were unsuccessful. Docker manifest v1 status code ${responseV1['code']} (${responseV1['message']}). Docker manifest v2 status code ${responseV2['code']} (${responseV2['message']}).`,
    )
  }
}

const getManifest = (getCmd) => async (tag) => {
  const response = await getCmd(`manifests/${tag}`)

  const responseBody = await response.readBody()

  const manifest = JSON.parse(responseBody)

  return manifest
}

module.exports = {
  getManifest,
  createDockerAPIClient,
  dockerAPIGet,
}
