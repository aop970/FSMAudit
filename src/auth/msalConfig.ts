import type { Configuration, PopupRequest } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_MSAL_CLIENT_ID as string | undefined;
const tenantId = import.meta.env.VITE_MSAL_TENANT_ID as string | undefined;

if (!clientId) {
  throw new Error(
    'VITE_MSAL_CLIENT_ID is not set. Add it to .env.local for local dev or Railway env vars for production.'
  );
}

if (!tenantId) {
  throw new Error(
    'VITE_MSAL_TENANT_ID is not set. Add it to .env.local for local dev or Railway env vars for production.'
  );
}

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
};

export const loginRequest: PopupRequest = {
  scopes: ['User.Read'],
};
