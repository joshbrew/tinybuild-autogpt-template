// /backend/serverUtil.js
import dotenv from 'dotenv';
dotenv.config();

/**
 * Get an environment variable, falling back to a default.
 */
export function getEnvVar(name, defaultValue) {
  return process.env[name] ?? defaultValue;
}

/**
 * Set common headers (incl. CORS) and status code on the response.
 */
export function setHeaders(response, statusCode, contentType = 'application/json') {
  response.writeHead(statusCode, {
    'Content-Type':                contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS, DELETE, PATCH',
    'Access-Control-Allow-Headers':'Content-Type'
  });
}

/**
 * Read the full request body as a string.
 */
export async function getRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}
