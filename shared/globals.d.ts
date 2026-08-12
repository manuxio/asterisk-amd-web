/**
 * Versione dell'applicazione, sostituita alla compilazione da esbuild
 * (scripts/build-server.mjs) leggendola da package.json. Non esiste a
 * runtime come variabile: e' un valore letterale nel bundle, perche'
 * l'eseguibile singolo non porta con se' il package.json.
 */
declare const __APP_VERSION__: string;
