'use client';

import type { SelectHTMLAttributes } from 'react';

export interface SelectProps
  extends SelectHTMLAttributes<HTMLSelectElement> {}

export function Select({ className = '', ...props }: SelectProps) {
  return (
    <select
      className={`h-9 w-full rounded-md border border-slate-300 px-3 ` +
        `text-sm text-slate-900 shadow-sm focus:border-slate-500 ` +
        `focus:outline-none focus:ring-1 focus:ring-slate-500 ` +
        `disabled:cursor-not-allowed disabled:bg-slate-100 ${className}`}
      {...props}
    />
  );
}
