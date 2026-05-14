import type { ReactNode } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { Shield } from 'lucide-react';
import { loginRequest } from './msalConfig';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const isAuthenticated = useIsAuthenticated();
  const { instance, inProgress } = useMsal();

  const isLoading = inProgress !== InteractionStatus.None;

  async function handleSignIn() {
    try {
      await instance.loginRedirect(loginRequest);
    } catch (err) {
      console.error('Sign-in failed:', err);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <div className="w-8 h-8 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">Initializing…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 flex flex-col items-center gap-6 w-full max-w-sm shadow-2xl">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-gray-800 text-blue-400">
            <Shield size={32} />
          </div>

          <div className="text-center">
            <h1 className="text-xl font-semibold text-white tracking-tight">
              FSM Invoice Audit
            </h1>
            <p className="mt-1 text-sm text-gray-400">
              Sign in with your Microsoft account to continue.
            </p>
          </div>

          <button
            onClick={handleSignIn}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-medium text-white text-sm transition-opacity hover:opacity-90 active:opacity-80"
            style={{ backgroundColor: '#0078d4' }}
          >
            {/* Microsoft logo mark */}
            <svg width="18" height="18" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="9" height="9" fill="#F25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
              <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
              <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
            </svg>
            Sign in with Microsoft
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
