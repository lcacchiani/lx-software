# Architecture Overview

This repository hosts a single public-facing website for LX Software. The site
is built with Vite, React Router, TanStack Query, and Bootstrap 5, then deployed
to S3 and served via CloudFront.

## High-level diagram

```
Vite React App
    |
    v
S3 (static assets) -> CloudFront (CDN + HTTPS)
```

## Components

### Public website (apps/public_www)
- React Router manages navigation and page structure.
- TanStack Query handles async data fetching and caching.
- Bootstrap 5 provides responsive layout and styling.

### Infrastructure (backend/infrastructure)
- AWS CDK provisions an S3 bucket and CloudFront distribution.
- CloudFront serves `index.html` for SPA routes (403/404 fallback).

## CI/CD

- GitHub Actions uses OIDC to assume AWS roles.
- Deployments build the site and sync assets to S3.
- CloudFront invalidations ensure fresh content.

## Dependency management

Dependabot monitors:
- GitHub Actions workflows in `/`.
- npm packages for `apps/public_www` and `backend/infrastructure`.
