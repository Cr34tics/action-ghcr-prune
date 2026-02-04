import { HttpClient, HttpClientResponse } from '@actions/http-client';
import { DockerManifest } from './types';
export declare const createDockerAPIClient: () => HttpClient;
export declare const dockerAPIGet: (client: HttpClient, token: string, owner: string, container: string) => (resource: string) => Promise<HttpClientResponse>;
export declare const getManifest: (getCmd: (resource: string) => Promise<HttpClientResponse>) => (tag: string) => Promise<DockerManifest>;
