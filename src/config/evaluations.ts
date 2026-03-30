export interface EvalConfig {
  id: string;
  name: string;
  category: string;
  path: string;
}

export const EVALUATIONS: EvalConfig[] = [
  {
    id: 'react_quickstart',
    name: 'React Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/react',
  },
  {
    id: 'nextjs_quickstart',
    name: 'Next.js App Router Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/nextjs',
  },
  {
    id: 'swift_quickstart',
    name: 'Swift iOS Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/swift',
  },
  {
    id: 'express_quickstart',
    name: 'Express Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/express',
  },
  {
    id: 'express_api_quickstart',
    name: 'Express API Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/express-api',
  },
  {
    id: 'fastapi_quickstart',
    name: 'FastAPI Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/fastapi',
  },
];
