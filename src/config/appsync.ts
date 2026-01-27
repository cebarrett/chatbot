// AppSync configuration
// These values are set after Terraform deployment via environment variables

export interface AppSyncConfig {
  endpoint: string;
  region: string;
}

export function getAppSyncConfig(): AppSyncConfig {
  const endpoint = import.meta.env.VITE_APPSYNC_URL;
  const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';

  if (!endpoint) {
    throw new Error(
      'AppSync configuration missing. Please set VITE_APPSYNC_URL in your .env file.'
    );
  }

  return { endpoint, region };
}

export function isAppSyncConfigured(): boolean {
  return !!import.meta.env.VITE_APPSYNC_URL;
}
