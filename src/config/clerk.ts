// Clerk configuration
// Set VITE_CLERK_PUBLISHABLE_KEY in your .env file

export function getClerkPublishableKey(): string {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!key) {
    throw new Error(
      'Clerk publishable key is missing. Set VITE_CLERK_PUBLISHABLE_KEY in your .env file.'
    );
  }

  return key;
}

export function isClerkConfigured(): boolean {
  return !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
}
