'use client';

import type { ReactNode } from 'react';

export interface CardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Card({
  title,
  description,
  children,
  className = '',
}: CardProps) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-6 ` +
        `shadow-sm ${className}`}
    >
      {(title || description) && (
        <header className='mb-4'>
          {title && <h2 className='text-lg font-semibold'>{title}</h2>}
          {description && (
            <p className='mt-1 text-sm text-slate-600'>{description}</p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
