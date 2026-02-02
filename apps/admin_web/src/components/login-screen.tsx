'use client';

import { Button } from './ui/button';
import { Card } from './ui/card';
import { StatusBanner } from './status-banner';
import { useAuth } from './auth-provider';

export function LoginScreen() {
  const { login, configErrors, error } = useAuth();
  const hasConfigErrors = configErrors.length > 0;
  const hasError = error.length > 0;

  return (
    <main className='mx-auto flex min-h-screen max-w-lg items-center px-6'>
      <Card
        title='Admin sign in'
        description='Sign in with your admin account to manage entries.'
        className='w-full'
      >
        {(hasError || hasConfigErrors) && (
          <div className='mb-4 space-y-2'>
            {hasError && (
              <StatusBanner variant='error' title='Login'>
                {error}
              </StatusBanner>
            )}
            {configErrors.map((configError) => (
              <StatusBanner key={configError} variant='error' title='Config'>
                {configError}
              </StatusBanner>
            ))}
          </div>
        )}
        <Button
          type='button'
          onClick={login}
          disabled={hasConfigErrors}
          className='w-full'
        >
          Continue to login
        </Button>
        <p className='mt-3 text-sm text-slate-600'>
          You must be in the admin group to access management tools.
        </p>
      </Card>
    </main>
  );
}
