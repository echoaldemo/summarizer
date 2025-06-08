import serverless from 'serverless-http';
import app from '../../src/index.js'; // Note: .js extension needed for ES modules

export const handler = serverless(app);