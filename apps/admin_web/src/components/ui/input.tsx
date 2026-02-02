'use client';

import type { InputHTMLAttributes } from 'react';

export interface InputProps
  extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className = '', ...props }: InputProps) {
  return (
    <input
      className={`h-9 w-full rounded-md border border-slate-300 px-3 ` +
        `text-sm text-slate-900 shadow-sm focus:border-slate-500 ` +
        `focus:outline-none focus:ring-1 focus:ring-slate-500 ` +
        `disabled:cursor-not-allowed disabled:bg-slate-100 ${className}`}
      {...props}
    />
  );
}
