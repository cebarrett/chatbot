# CLAUDE.md

This file provides guidance for Claude Code when working with this repository.

## Project Overview

This is a React + TypeScript frontend application built with Vite, designed to be deployed to Amazon S3.

## Commands

- `npm run dev` - Start development server (port 5173)
- `npm run build` - TypeScript compile and Vite production build
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build
- `npm run deploy` - Deploy to S3 (requires S3_BUCKET env var)

## Architecture

- **Entry point**: `src/main.tsx` renders App into `#root`
- **Main component**: `src/App.tsx`
- **Build output**: `dist/` directory
- **Static assets**: `public/` (copied as-is to build)

## Code Style

- TypeScript strict mode enabled
- ESLint with React hooks plugin
- Functional components with hooks
- CSS modules or plain CSS files alongside components

## Deployment

Deploys to S3 via `scripts/deploy.sh`. Requires:
- AWS CLI configured
- `S3_BUCKET` environment variable set
- Optional: `CLOUDFRONT_DISTRIBUTION_ID` for CDN cache invalidation

## File Conventions

- Components: PascalCase (e.g., `MyComponent.tsx`)
- Utilities: camelCase (e.g., `helpers.ts`)
- Styles: Same name as component (e.g., `App.css` for `App.tsx`)
