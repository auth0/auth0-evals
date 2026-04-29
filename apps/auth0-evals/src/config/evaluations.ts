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
    id: 'android_quickstart',
    name: 'Android Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/android',
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
  {
    id: 'fastify_api_quickstart',
    name: 'Fastify API Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/fastify-api',
  },
  {
    id: 'vue_quickstart',
    name: 'Vue Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/vue',
  },
  {
    id: 'nuxt_quickstart',
    name: 'Nuxt Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/nuxt',
  },
  {
    id: 'angular_quickstart',
    name: 'Angular Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/angular',
  },
  {
    id: 'spa_js_quickstart',
    name: 'SPA JS Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/spa-js',
  },
  {
    id: 'flask_quickstart',
    name: 'Flask Quickstart',
    category: 'quickstarts',
    path: 'src/evals/quickstarts/flask',
  },
];
