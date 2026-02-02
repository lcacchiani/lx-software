'use client';

import type { LabelHTMLAttributes } from 'react';

export interface LabelProps
  extends LabelHTMLAttributes<HTMLLabelElement> {}

export function Label({ className = '', ...props }: LabelProps) {
  return (
    <label
      className={`text-sm font-medium text-slate-700 ${className}`}
      {...props}
    />
  );
}
