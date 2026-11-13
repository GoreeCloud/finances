/**
 * Synthetic GoreeCloud Mesh finance access descriptor.
 * No connectors, credentials, network access or payment capability.
 * This is an informational fail-closed fixture, NOT a production authorization layer.
 */
export const FINANCE_INSTITUTIONS = Object.freeze([
  ['navy-federal', 'Navy Federal Credit Union'],
  ['cash-app', 'Cash App'],
  ['varo', 'Varo'],
  ['capital-one', 'Capital One'],
  ['marcus', 'Marcus by Goldman Sachs'],
  ['discover', 'Discover'],
  ['paypal', 'PayPal'],
].map(([id, name]) => Object.freeze({
  id, name, coverage: 'unverified', liveConnection: 'disabled',
  grantedScopes: Object.freeze([]), offlineImport: 'normalized-csv-only',
})));

const READ_ONLY_INTENTS = new Set(['accounts.read', 'balances.read', 'transactions.read']);

/** Return an informational denial; no external access or permissions are granted. */
export function checkFinanceIntent({ institutionId, capability } = {}) {
  const entry = FINANCE_INSTITUTIONS.find(item => item.id === institutionId);
  if (!entry) return Object.freeze({ status: 'unsupported', liveAllowed: false });
  if (!READ_ONLY_INTENTS.has(capability)) {
    return Object.freeze({ status: 'denied', liveAllowed: false });
  }
  return Object.freeze({ status: 'unavailable', liveAllowed: false });
}

export function assertDisabledFinanceCatalog(entries = FINANCE_INSTITUTIONS) {
  if (!Array.isArray(entries) || entries.length !== 7) throw new Error('Expected seven offline institutions');
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id) || typeof entry.id !== 'string') throw new Error('Duplicate or invalid institution');
    ids.add(entry.id);
    if (entry.coverage !== 'unverified' || entry.liveConnection !== 'disabled' ||
      !Array.isArray(entry.grantedScopes) || entry.grantedScopes.length !== 0) {
      throw new Error('Unverified live financial capability detected');
    }
  }
  return true;
}
