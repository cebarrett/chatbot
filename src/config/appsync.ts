// AppSync configuration
// These values are set after Terraform deployment via environment variables

export interface AppSyncConfig {
  endpoint: string;
  apiKey: string;
  region: string;
}

export function getAppSyncConfig(): AppSyncConfig {
  const endpoint = import.meta.env.VITE_APPSYNC_URL;
  const apiKey = import.meta.env.VITE_APPSYNC_API_KEY;
  const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';

  if (!endpoint || !apiKey) {
    throw new Error(
      'AppSync configuration missing. Please set VITE_APPSYNC_URL and VITE_APPSYNC_API_KEY in your .env file.'
    );
  }

  return { endpoint, apiKey, region };
}

export function isAppSyncConfigured(): boolean {
  return !!(import.meta.env.VITE_APPSYNC_URL && import.meta.env.VITE_APPSYNC_API_KEY);
}
