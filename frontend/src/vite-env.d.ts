/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USER_POOL_ID: string;
  readonly VITE_USER_POOL_CLIENT_ID: string;
  readonly VITE_IDENTITY_POOL_ID: string;
  readonly VITE_AGENT_RUNTIME_ARN: string;
  readonly VITE_REMEDIATOR_RUNTIME_ARN: string;
  readonly VITE_REMEDIATOR_GATEWAY_URL: string;
  readonly VITE_AWS_REGION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
