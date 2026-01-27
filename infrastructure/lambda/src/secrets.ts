import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { LLMSecrets } from './types';

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

let cachedSecrets: LLMSecrets | null = null;

export async function getSecrets(): Promise<LLMSecrets> {
  if (cachedSecrets) {
    return cachedSecrets;
  }

  const secretName = process.env.SECRETS_NAME;
  if (!secretName) {
    throw new Error('SECRETS_NAME environment variable not set');
  }

  const command = new GetSecretValueCommand({
    SecretId: secretName,
  });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error('Secret value is empty');
  }

  cachedSecrets = JSON.parse(response.SecretString) as LLMSecrets;
  return cachedSecrets;
}

export function clearSecretsCache(): void {
  cachedSecrets = null;
}
