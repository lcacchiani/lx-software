'use client';

import type { ReactNode } from 'react';

import { Button } from './ui/button';

export interface NavSection {
  key: string;
  label: string;
}

export interface AppShellProps {
  sections: NavSection[];
  activeKey: string;
  onSelect: (key: string) => void;
  onLogout: () => void;
  userEmail?: string;
  children: ReactNode;
}

export function AppShell({
  sections,
  activeKey,
  onSelect,
  onLogout,
  userEmail,
  children,
}: AppShellProps) {
  return (
    <div className='min-h-screen'>
      <header className='border-b border-slate-200 bg-white'>
        <div
          className={
            'mx-auto flex max-w-6xl items-center justify-between px-6 py-4'
          }
        >
          <div>
            <h1 className='text-xl font-semibold'>Siu Tin Dei Admin</h1>
            <p className='text-sm text-slate-500'>
              Manage organizations, activities, and schedules.
            </p>
          </div>
          <div className='flex items-center gap-3'>
            {userEmail && (
              <span className='text-sm text-slate-600'>{userEmail}</span>
            )}
            <Button variant='secondary' onClick={onLogout}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <div className='mx-auto flex max-w-6xl gap-6 px-6 py-6'>
        <aside className='w-56 shrink-0'>
          <nav className='space-y-1'>
            {sections.map((section) => {
              const isActive = section.key === activeKey;
              return (
                <button
                  key={section.key}
                  type='button'
                  onClick={() => onSelect(section.key)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {section.label}
                </button>
              );
            })}
          </nav>
        </aside>
        <main className='min-w-0 flex-1 space-y-6'>{children}</main>
      </div>
    </div>
  );
}
