import localFont from 'next/font/local'

// Dinghy brand type, self-hosted (OFL, see src/fonts/OFL-LICENSES.txt).
// Fraunces is variable: pages set font-variation-settings 'SOFT' 100 for the brand look.
export const fraunces = localFont({
  src: [
    { path: '../fonts/fraunces-var.woff2', style: 'normal', weight: '100 900' },
    { path: '../fonts/fraunces-var-italic.woff2', style: 'italic', weight: '100 900' },
  ],
  variable: '--font-fraunces',
  display: 'swap',
  fallback: ['Georgia', 'serif'],
})

export const schibsted = localFont({
  src: [
    { path: '../fonts/schibsted-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/schibsted-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/schibsted-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-schibsted',
  display: 'swap',
  fallback: ['-apple-system', 'Helvetica Neue', 'Arial', 'sans-serif'],
})

export const dmMono = localFont({
  src: [
    { path: '../fonts/dmmono-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/dmmono-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-dmmono',
  display: 'swap',
  fallback: ['ui-monospace', 'Menlo', 'monospace'],
})
