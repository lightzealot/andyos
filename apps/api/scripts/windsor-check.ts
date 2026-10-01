/**
 * Comprobación de SOLO LECTURA de la conexión con Windsor. No publica nada ni muestra la clave.
 * Uso:  WINDSOR_API_KEY=… npx tsx scripts/windsor-check.ts   (o con --env-file=../../.env.production)
 */
import { windsorListTools } from '../src/windsor.js';

const key = process.env.WINDSOR_API_KEY;
if (!key) { console.error('Falta WINDSOR_API_KEY.'); process.exit(1); }
const url = process.env.WINDSOR_MCP_URL || 'https://mcp.windsor.ai/';
const r = await windsorListTools({ url, key });
if (!r.ok) { console.error(`✗ ${r.error}`); process.exit(2); }
console.log(`✓ Conexión correcta con ${url}`);
console.log(`  Herramientas (${r.tools.length}): ${r.tools.join(', ')}`);
console.log(r.tools.includes('execute_action') ? '  ✓ «execute_action» disponible (es la que publica).' : '  ✗ No aparece «execute_action»: no se podría publicar.');
