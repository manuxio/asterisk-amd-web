/*
 * ensure-assets.mjs — crea il segnaposto di assets.generated.ts se manca.
 *
 * Quel file e' generato (contiene il client in base64) e non e' versionato:
 * su un clone pulito typecheck e build del solo server fallirebbero per un
 * import irrisolto. Qui si crea un segnaposto vuoto; con esso static.ts
 * serve dist/client da disco, mentre `npm run build` lo sostituisce con i
 * file veri.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'server', 'src', 'assets.generated.ts');

if (!fs.existsSync(file)) {
  fs.writeFileSync(
    file,
    '/* GENERATO da scripts/embed-assets.mjs — non modificare a mano.\n' +
      " * Segnaposto: `npm run build` lo sostituisce con i file compilati del client\n" +
      ' * in base64. Finche\' e\' vuoto, static.ts serve dist/client da disco. */\n' +
      'export const EMBEDDED_ASSETS: Record<string, string> = {};\n',
  );
  console.log('ensure-assets: creato il segnaposto server/src/assets.generated.ts');
}
