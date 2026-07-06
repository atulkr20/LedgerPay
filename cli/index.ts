// ─────────────────────────────────────────────────────────────
//  LedgerPay CLI  –  production-grade terminal client
// ─────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000';

// ── ANSI color helpers ───────────────────────────────────────
const R = '\x1b[0m';           // reset
const BOLD   = (s: string) => `\x1b[1m${s}${R}`;
const DIM    = (s: string) => `\x1b[38;2;120;120;120m${s}${R}`;

// Premium RGB Palette (VT100 24-bit TrueColor)
const TEAL   = (s: string) => `\x1b[38;2;0;242;254m${s}${R}`;
const PURPLE = (s: string) => `\x1b[38;2;161;140;209m${s}${R}`;
const GREEN  = (s: string) => `\x1b[38;2;0;255;135m${s}${R}`;
const RED    = (s: string) => `\x1b[38;2;255;75;75m${s}${R}`;
const YELLOW = (s: string) => `\x1b[38;2;245;208;97m${s}${R}`;
const WHITE  = (s: string) => `\x1b[38;2;255;255;255m${s}${R}`;

// Global buffer and state — holds leftover characters between readLine() calls
let inputBuffer = '';
let expectLeftoverNewline = false;

function cleanInput(str: string): string {
  const chars: string[] = [];
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '\x7f' || char === '\b') {
      chars.pop();
    } else {
      chars.push(char);
    }
  }
  let processed = chars.join('');
  // Strip ANSI escape sequences (e.g. arrow keys \x1b[A, colors, etc.)
  processed = processed.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  return processed.trim();
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    function processBuffer() {
      // If we are expecting a leftover \n from a previous \r, consume/clear it now
      if (expectLeftoverNewline && inputBuffer.length > 0) {
        if (inputBuffer.startsWith('\n')) {
          inputBuffer = inputBuffer.slice(1);
        }
        expectLeftoverNewline = false;
      }

      // Now search for the next \r or \n
      const index = inputBuffer.search(/[\r\n]/);
      if (index !== -1) {
        const line = inputBuffer.slice(0, index);
        const delimiter = inputBuffer[index];

        // Advance buffer past the delimiter
        inputBuffer = inputBuffer.slice(index + 1);

        if (delimiter === '\r') {
          // If the \n is already in the buffer, consume it
          if (inputBuffer.startsWith('\n')) {
            inputBuffer = inputBuffer.slice(1);
            expectLeftoverNewline = false;
          } else {
            // Otherwise, expect it to arrive next
            expectLeftoverNewline = true;
          }
        } else {
          expectLeftoverNewline = false;
        }

        process.stdin.removeListener('data', onData);
        resolve(cleanInput(line));
        return true;
      }
      return false;
    }

    function onData(chunk: Buffer) {
      inputBuffer += chunk.toString();
      processBuffer();
    }

    // Try processing what's already in the buffer
    if (!processBuffer()) {
      process.stdin.on('data', onData);
    }
  });
}

async function ask(label: string, isPassword = false): Promise<string> {
  if (isPassword) {
    process.stdout.write('\x01echo_off\x02');
  }
  process.stdout.write(TEAL('  ➔ ') + WHITE(label));
  const val = await readLine();
  if (isPassword) {
    process.stdout.write('\x01echo_on\x02');
  }
  return val;
}

function chooseOption(options: string[], defaultIndex = 0): Promise<number> {
  return new Promise((resolve) => {
    let index = defaultIndex;
    inputBuffer = '';
    expectLeftoverNewline = false;

    function render() {
      clear();
      banner();
      statusBar();

      console.log('  ' + BOLD(WHITE('SELECT AN ACTION:')) + '\n');
      for (let i = 0; i < options.length; i++) {
        if (i === index) {
          console.log('  ' + TEAL('➔') + '  ' + BOLD(WHITE(options[i])));
        } else {
          console.log('     ' + DIM(options[i]));
        }
      }
      console.log('');
      console.log('  ' + DIM('[Use ↑/↓ Arrow Keys, Press Enter to Select]'));
    }

    function onKey(chunk: Buffer) {
      const key = chunk.toString();
      if (key === '\u001b[A') { // Up Arrow
        index = (index - 1 + options.length) % options.length;
        render();
      } else if (key === '\u001b[B') { // Down Arrow
        index = (index + 1) % options.length;
        render();
      } else if (key === '\r' || key === '\n') { // Enter
        process.stdin.removeListener('data', onKey);
        resolve(index);
      }
    }

    render();
    process.stdin.on('data', onKey);
  });
}

// ── HTTP helper ──────────────────────────────────────────────
async function api(
  method: string,
  endpoint: string,
  body?: object,
  token?: string,
  idempotencyKey?: string
): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token)          headers['Authorization']  = 'Bearer ' + token;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(BASE_URL + endpoint, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── Session ──────────────────────────────────────────────────
const session = { token: '', accountId: '', email: '' };

// ── UI helpers ───────────────────────────────────────────────
function clear() { process.stdout.write('\x1bc'); }

function banner() {
  clear();
  console.log(TEAL(BOLD('┌──────────────────────────────────────────────────────────────────────────────────┐')));
  console.log(TEAL(BOLD('│                                                                                  │')));
  console.log(TEAL(BOLD('│  ██╗     ███████╗██████╗  ██████╗ ███████╗██████╗     ██████╗  █████╗ ██╗   ██╗  │')));
  console.log(TEAL(BOLD('│  ██║     ██╔════╝██╔══██╗██╔════╝ ██╔════╝██╔══██╗    ██╔══██╗██╔══██╗╚██╗ ██╔╝  │')));
  console.log(TEAL(BOLD('│  ██║     █████╗  ██║  ██║██║  ███╗█████╗  ██████╔╝    ██████╔╝███████║ ╚████╔╝   │')));
  console.log(TEAL(BOLD('│  ██║     ██╔══╝  ██║  ██║██║   ██║██╔══╝  ██╔══██╗    ██╔═══╝ ██╔══██║  ╚██╔╝    │')));
  console.log(TEAL(BOLD('│  ███████╗███████╗██████╔╝╚██████╔╝███████╗██║  ██║    ██║     ██║  ██║   ██║     │')));
  console.log(TEAL(BOLD('│  ╚══════╝╚══════╝╚═════╝  ╚═════╝ ╚══════╝╚═╝  ╚═╝    ╚═╝     ╚═╝  ╚═╝   ╚═╝     │')));
  console.log(TEAL(BOLD('│                                                                                  │')));
  console.log(TEAL(BOLD('│                       LEDGER PAY  ·  PRODUCTION WALLET                           │')));
  console.log(TEAL(BOLD('└──────────────────────────────────────────────────────────────────────────────────┘')));
  console.log('');
}

function ok(msg: string)   { console.log('\n  ' + GREEN('[OK]')    + '  ' + msg); }
function err(msg: any) {
  let formatted = '';
  if (typeof msg === 'string') {
    formatted = msg;
  } else if (Array.isArray(msg)) {
    formatted = msg.map(m => {
      const field = m.path ? `[${m.path.join('.')}] ` : '';
      return `${field}${m.message || JSON.stringify(m)}`;
    }).join(', ');
  } else if (typeof msg === 'object' && msg !== null) {
    formatted = msg.message || JSON.stringify(msg);
  } else {
    formatted = String(msg);
  }
  console.log('\n  ' + RED('[ERR]')   + '  ' + formatted);
}
function info(msg: string) { console.log('  ' + DIM(msg)); }
function sep()             { console.log(DIM('  ' + '─'.repeat(82))); }

function statusBar() {
  if (session.email) {
    console.log(TEAL('  ┌── SESSION PROFILE ───────────────────────────────────────────────────────────────┐'));
    console.log(TEAL('  │ ') + WHITE('User: ') + YELLOW(session.email.padEnd(26)) + TEAL(' │ ') + WHITE('Account: ') + YELLOW(session.accountId.padEnd(36)) + TEAL(' │'));
    console.log(TEAL('  └──────────────────────────────────────────────────────────────────────────────────┘'));
  } else {
    console.log(RED('  ┌── STATUS ────────────────────────────────────────────────────────────────────────┐'));
    console.log(RED('  │ ') + WHITE('Session Status: ') + RED('Not Authenticated'.padEnd(64)) + RED(' │'));
    console.log(RED('  └──────────────────────────────────────────────────────────────────────────────────┘'));
  }
  console.log('');
}

// ── Auth actions ─────────────────────────────────────────────
async function signup() {
  banner();
  console.log(BOLD('  SIGN UP\n'));
  const email    = await ask('Email:             ');
  const password = await ask('Password:          ', true);
  const name     = await ask('Name (optional):   ');

  info('Creating account...');
  const r = await api('POST', '/api/auth/signup', { email, password, name });

  if (r.userId) {
    ok('Account created. You can now log in.');
  } else {
    err(r.error || 'Signup failed');
  }
  console.log('');
  await ask('Press Enter to continue...');
}

async function login() {
  banner();
  console.log(BOLD('  LOGIN\n'));
  const email    = await ask('Email:    ');
  const password = await ask('Password: ', true);

  info('Authenticating...');
  const r = await api('POST', '/api/auth/login', { email, password });

  if (r.token) {
    session.token     = r.token;
    session.accountId = r.accountId;
    session.email     = email;
    ok('Logged in as ' + email);
    info('Account ID: ' + r.accountId);
  } else {
    err(r.error || 'Login failed');
  }
  console.log('');
  await ask('Press Enter to continue...');
}

// ── Wallet actions ───────────────────────────────────────────
async function getBalance() {
  info('Fetching balance...');
  const r = await api('GET', '/api/wallets/' + session.accountId + '/balance', undefined, session.token);

  if (r.success) {
    console.log('');
    const balText = '$' + parseFloat(r.balance).toFixed(4);
    const innerWidth = 32;
    const label = '  Balance: ';
    const spacesNeeded = innerWidth - label.length - balText.length;
    const padding = spacesNeeded > 0 ? ' '.repeat(spacesNeeded) : '';

    console.log(TEAL('  ┌' + '─'.repeat(innerWidth) + '┐'));
    console.log(TEAL('  │') + label + GREEN(BOLD(balText)) + padding + TEAL(' │'));
    console.log(TEAL('  └' + '─'.repeat(innerWidth) + '┘'));
  } else {
    err(r.error || 'Failed');
  }
  console.log('');
  await ask('Press Enter to continue...');
}

async function deposit() {
  banner();
  console.log(BOLD('  DEPOSIT\n'));
  const amount = await ask('Amount ($): ');

  info('Processing deposit...');
  const r = await api(
    'POST', '/api/wallets/add-money',
    { accountId: session.accountId, amount: parseFloat(amount) },
    session.token,
    'dep-' + Date.now()
  );

  if (r.success) {
    ok('Deposited $' + parseFloat(amount).toFixed(4));
    info('Transaction ID: ' + r.transaction.id);
  } else {
    err(r.error || 'Deposit failed');
  }
  console.log('');
  await ask('Press Enter to continue...');
}

async function transfer() {
  banner();
  console.log(BOLD('  TRANSFER\n'));
  info('Your Account ID: ' + session.accountId);
  console.log('');
  const toRaw  = await ask('Recipient Account ID: ');
  const to     = toRaw.replace(/[^0-9a-fA-F-]/g, '').trim().toLowerCase();
  console.log('  ' + DIM(`[Debug] Cleaned Length: ${to.length}, Content: ${JSON.stringify(to)}`));
  const amount = await ask('Amount ($):           ');

  info('Executing double-entry transfer...');
  const r = await api(
    'POST', '/api/wallets/transfer',
    {
      fromAccountId: session.accountId.replace(/[^0-9a-fA-F-]/g, '').trim().toLowerCase(),
      toAccountId: to,
      amount: parseFloat(amount)
    },
    session.token,
    'tx-' + Date.now()
  );

  if (r.success) {
    ok('Transferred $' + parseFloat(amount).toFixed(4));
    info('Transaction ID: ' + r.transaction.id);
  } else {
    err(r.error || 'Transfer failed');
  }
  console.log('');
  await ask('Press Enter to continue...');
}

async function withdraw() {
  banner();
  console.log(BOLD('  WITHDRAW\n'));
  const amount = await ask('Amount ($): ');

  info('Processing withdrawal...');
  const r = await api(
    'POST', '/api/wallets/withdraw',
    { accountId: session.accountId, amount: parseFloat(amount) },
    session.token,
    'wdr-' + Date.now()
  );

  if (r.success) {
    ok('Withdrew $' + parseFloat(amount).toFixed(4));
    info('Transaction ID: ' + r.transaction.id);
  } else {
    err(r.error || 'Withdrawal failed');
  }
  console.log('');
  await ask('Press Enter to continue...');
}

async function refund() {
  banner();
  console.log(BOLD('  REFUND TRANSACTION\n'));
  const txIdRaw = await ask('Original Transaction ID: ');
  const txId = txIdRaw.replace(/[^0-9a-fA-F-]/g, '').trim().toLowerCase();

  info('Executing double-entry refund reversal...');
  const r = await api(
    'POST', '/api/wallets/refund',
    { originalTransactionId: txId },
    session.token,
    'ref-' + Date.now()
  );

  if (r.success) {
    ok('Transaction refunded successfully.');
    info('Refund Transaction ID: ' + r.transaction.id);
  } else {
    err(r.error || 'Refund failed');
  }
  console.log('');
  await ask('Press Enter to continue...');
}

async function txHistory() {
  info('Fetching ledger entries...');
  const r = await api(
    'GET',
    '/api/wallets/' + session.accountId + '/history?limit=10&offset=0',
    undefined,
    session.token
  );

  if (!r.success) { err(r.error || 'Failed'); console.log(''); await ask('Press Enter...'); return; }

  console.log('');
  console.log(TEAL('  ┌' + '─'.repeat(80) + '┐'));
  console.log(TEAL('  │ ') + BOLD(WHITE('DATE (UTC)'.padEnd(21) + 'TYPE'.padEnd(12) + 'ENTRY'.padEnd(9) + 'AMOUNT'.padEnd(20) + 'STATUS'.padEnd(18))) + TEAL(' │'));
  console.log(TEAL('  ├' + '─'.repeat(80) + '┤'));

  for (const e of r.data) {
    const date   = new Date(e.createdAt).toISOString().replace('T',' ').slice(0,19).padEnd(21);
    const type   = (e.transaction.type || '').padEnd(12);
    const entry  = e.entryType.padEnd(9);
    const amt    = parseFloat(e.amount);
    const isCredit = e.entryType === 'CREDIT';
    const amtStr = (isCredit ? '+$' : '-$') + Math.abs(amt).toFixed(4);
    const amtColored = (isCredit ? GREEN(amtStr) : RED(amtStr)) + ' '.repeat(20 - amtStr.length);
    const statusStr = e.transaction.status;
    const statusColored = (statusStr === 'SUCCESS' ? GREEN(statusStr) : YELLOW(statusStr)) + ' '.repeat(18 - statusStr.length);

    console.log(TEAL('  │ ') + date + type + entry + amtColored + statusColored + TEAL(' │'));
    console.log(TEAL('  │ ') + DIM(`  ↳ ID: ${e.transaction.id}`.padEnd(80)) + TEAL(' │'));
  }

  console.log(TEAL('  └' + '─'.repeat(80) + '┘'));
  info('Total records: ' + r.totalRecords);
  console.log('');
  await ask('Press Enter to continue...');
}

// ── Menus ────────────────────────────────────────────────────
// ── Menus ────────────────────────────────────────────────────
async function loggedOutMenu(): Promise<boolean> {
  const choices = [
    'Login to Wallet',
    'Register New Account',
    'Exit Application'
  ];
  
  const index = await chooseOption(choices);
  switch (index) {
    case 0: await login();  break;
    case 1: await signup(); break;
    case 2: return false;
  }
  return true;
}

async function loggedInMenu(): Promise<boolean> {
  const choices = [
    'Check Balance',
    'Transaction History',
    'Deposit Money',
    'Transfer Funds',
    'Withdraw Money',
    'Refund Transaction',
    'Log Out',
    'Exit Application'
  ];

  const index = await chooseOption(choices);
  switch (index) {
    case 0: banner(); statusBar(); await getBalance(); break;
    case 1: banner(); statusBar(); await txHistory(); break;
    case 2: await deposit(); break;
    case 3: await transfer(); break;
    case 4: await withdraw(); break;
    case 5: await refund(); break;
    case 6:
      session.token = ''; session.accountId = ''; session.email = '';
      ok('Logged out successfully.');
      await ask('Press Enter to continue...');
      break;
    case 7: return false;
  }
  return true;
}

// ── Entry point ──────────────────────────────────────────────
async function main() {
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let running = true;
  while (running) {
    if (session.token) {
      running = await loggedInMenu();
    } else {
      running = await loggedOutMenu();
    }
  }

  clear();
  console.log(TEAL('\n  Goodbye.\n'));
  process.exit(0);
}

main().catch((e) => {
  console.error(RED('\n  Fatal: ' + e.message));
  process.exit(1);
});
