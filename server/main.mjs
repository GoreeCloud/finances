import { createFinanceServer } from './app.mjs';
const port = Number(process.env.GOREE_FINANCES_PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port from 1024 to 65535');
const options = { port };
if (process.env.GOREE_FINANCES_DATA_FILE) options.dataFile = process.env.GOREE_FINANCES_DATA_FILE;
const { server, plaid } = createFinanceServer(options);
server.listen(port, '127.0.0.1', () => {
  console.log('GoreeCloud Finances local dashboard: http://127.0.0.1:' + port);
  console.log('Provider linking: ' + (plaid.enabled ? plaid.environment + ' (configured)' : 'disabled; CSV import only'));
  console.log('Loopback-only development server. Do not expose this port publicly.');
});
