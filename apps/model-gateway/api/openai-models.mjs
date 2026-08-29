import { authorized } from '../lib/security.mjs';
import { logicalInventory } from '../lib/openai-compat.mjs';

export default function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'method_not_allowed' });
  if (!authorized(request)) return response.status(401).json({ error: 'unauthorized' });
  return response.status(200).json(logicalInventory());
}
