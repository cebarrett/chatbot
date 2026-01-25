# Chatbot

A React + TypeScript frontend application built with Vite.

## Prerequisites

- Node.js 18+
- npm 9+
- AWS CLI (for deployment)

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm run deploy` | Deploy to S3 |

## Deployment

This project deploys to Amazon S3 for static hosting.

### Setup

1. Configure AWS CLI with your credentials:
   ```bash
   aws configure
   ```

2. Create an S3 bucket with static website hosting enabled

3. Set up your environment:
   ```bash
   cp .env.example .env
   # Edit .env with your S3_BUCKET name
   ```

### Deploy

```bash
# Deploy with environment variable
S3_BUCKET=your-bucket-name npm run deploy

# Or with .env configured
npm run deploy
```

### CloudFront (Optional)

For CloudFront cache invalidation, set the distribution ID:

```bash
S3_BUCKET=your-bucket CLOUDFRONT_DISTRIBUTION_ID=EXXXXX npm run deploy
```

## Project Structure

```
├── public/             # Static assets
├── src/
│   ├── assets/         # Images and other assets
│   ├── App.tsx         # Main application component
│   ├── App.css         # Application styles
│   ├── main.tsx        # Application entry point
│   └── index.css       # Global styles
├── scripts/
│   └── deploy.sh       # S3 deployment script
├── index.html          # HTML entry point
├── vite.config.ts      # Vite configuration
├── tsconfig.json       # TypeScript configuration
└── eslint.config.js    # ESLint configuration
```

## Tech Stack

- React 19
- TypeScript 5.9
- Vite 7
- ESLint
