/**
 * Remediator Agent Runtime API client.
 * Invokes the Remediator agent (Runtime 2) using SigV4-signed HTTP requests.
 * Sends remediation actions for Cedar policy evaluation and execution.
 */

import { fetchAuthSession } from '@aws-amplify/auth';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@aws-sdk/protocol-http';
import type { RemediationRequest, RemediationResponse } from '../types';

export interface InvokeRemediatorParams {
  runtimeArn: string;
  region: string;
  action_type: string;
  resource_id: string;
  parameters: Record<string, string>;
  risk_level: string;
  jwt_token: string;
}

export async function invokeRemediator(params: InvokeRemediatorParams): Promise<RemediationResponse> {
  const session = await fetchAuthSession();
  const credentials = session.credentials;
  if (!credentials) {
    throw new Error('No authenticated credentials available');
  }

  const hostname = `bedrock-agentcore.${params.region}.amazonaws.com`;
  const encodedArn = encodeURIComponent(params.runtimeArn);
  const path = `/runtimes/${encodedArn}/invocations`;

  const body = JSON.stringify({
    action_type: params.action_type,
    resource_id: params.resource_id,
    parameters: params.parameters,
    risk_level: params.risk_level,
    jwt_token: params.jwt_token,
  } satisfies RemediationRequest);

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
    },
    body,
  });

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
  const url = `https://${hostname}${path}?qualifier=DEFAULT`;

  const response = await fetch(url, {
    method: 'POST',
    headers: signedRequest.headers as Record<string, string>,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Remediator error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    authorized: data.authorized ?? false,
    decision: data.decision ?? 'DENY',
    reason: data.reason ?? 'Unknown',
    execution_result: data.execution_result,
  };
}
