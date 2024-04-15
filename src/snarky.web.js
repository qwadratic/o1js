import './bindings/crypto/bindings.js';
import {
  initializeBindings as init,
  withThreadPool,
} from './bindings/js/web/web-backend.js';

let Snarky, Ledger, Pickles, Test_;
let isInitialized = false;

async function initializeBindings() {
  if (isInitialized) return;
  isInitialized = true;

  await init();
  ({ Snarky, Ledger, Pickles, Test: Test_ } = globalThis.__snarky);
}

async function Test() {
  await initializeBindings();
  return Test_;
}

let wasm = globalThis.plonk_wasm;

export {
  Snarky,
  Ledger,
  Pickles,
  Test,
  withThreadPool,
  wasm,
  initializeBindings,
};
