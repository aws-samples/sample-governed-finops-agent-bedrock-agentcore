/**
 * AgentCore Runtime API client.
 * Invokes the agent using SigV4-signed HTTP requests with Cognito credentials.
 *
 * API: POST /runtimes/{agentRuntimeArn}/invocations
 * Docs: https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_InvokeAgentRuntime.html
 */

import { fetchAuthSession } from '@aws-amplify/auth';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@aws-sdk/protocol-http';

export interface InvokeAgentParams {
  runtimeArn: string;
  region: string;
  prompt: string;
  sessionId: string;
  userId: string;
}

export async function invokeAgent(params: InvokeAgentParams): Promise<string> {
  const session = await fetchAuthSession();
  const credentials = session.credentials;
  if (!credentials) {
    throw new Error('No authenticated credentials available');
  }

  const hostname = `bedrock-agentcore.${params.region}.amazonaws.com`;

  // URL-encode the ARN for the path (colons -> %3A, slashes -> %2F)
  const encodedArn = encodeURIComponent(params.runtimeArn);
  const path = `/runtimes/${encodedArn}/invocations`;

  const body = JSON.stringify({
    prompt: params.prompt,
    sessionId: params.sessionId,
    userId: params.userId,
    jwt_token: session.tokens?.accessToken?.toString() ?? '',
  });

  // Create the HTTP request
  const request = new HttpRequest({
    method: 'POST',
    protocol: 'https:',
    hostname,
    path,
    query: { qualifier: 'DEFAULT' },
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      host: hostname,
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': params.sessionId,
      'X-Amzn-Bedrock-AgentCore-Runtime-User-Id': params.userId,
    },
    body,
  });

  // Sign with SigV4
  const signer = new SignatureV4({
    service: 'bedrock-agentcore',
    region: params.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
    sha256: Sha256,
  });

  const signedRequest = await signer.sign(request);

  // Build the full URL with query string
  const url = `https://${hostname}${path}?qualifier=DEFAULT`;

  // Execute the request
  const response = await fetch(url, {
    method: 'POST',
    headers: signedRequest.headers as Record<string, string>,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AgentCore error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.result || data.message || JSON.stringify(data);
}
