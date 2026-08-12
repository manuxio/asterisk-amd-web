/*
 * quiet.ts — silenzia il solo warning "SQLite is an experimental feature".
 *
 * DEVE essere il primo import di index.ts: il warning viene emesso quando
 * node:sqlite viene caricato, e nel bundle i moduli importati si
 * inizializzano prima del corpo dell'entry point. Gli altri warning
 * passano invariati.
 */

const originalEmit = process.emit as (...args: unknown[]) => boolean;

process.emit = function (this: NodeJS.Process, name: string | symbol, ...args: unknown[]) {
  const data = args[0];
  if (
    name === 'warning' &&
    data instanceof Error &&
    data.name === 'ExperimentalWarning' &&
    /SQLite/i.test(data.message)
  )
    return false;
  return originalEmit.call(this, name, ...args);
} as typeof process.emit;

export {};
