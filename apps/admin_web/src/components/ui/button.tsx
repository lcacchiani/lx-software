'use client';

import type { ButtonHTMLAttributes } from 'react';

const baseStyles =
  'inline-flex items-center justify-center rounded-md text-sm ' +
  'font-semibold transition focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-slate-400 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

const variantStyles = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800',
  secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-500',
};

const sizeStyles = {
  sm: 'h-8 px-3',
  md: 'h-9 px-4',
  lg: 'h-10 px-5',
};

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantStyles;
  size?: keyof typeof sizeStyles;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${
        sizeStyles[size]
      } ${className}`}
      {...props}
    />
  );
}
