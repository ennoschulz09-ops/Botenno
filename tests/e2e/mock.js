// TEST-HARNESS: Mock-Antworten für E2E-Tests (nie Teil der App)
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function mint(i) { let s = 'Mk'; let x = i * 7919 + 13; while (s.length < 44) { s += B58[x % 58]; x = Math.floor(x / 3) + s.length * 31; } return s; }
const WSOL = 'So11111111111111111111111111111111111111112', USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const N = 40, tokens = [];
for (let i = 0; i < N; i++) tokens.push({ mint: mint(i), pair: mint(1000 + i), sym: 'MOCK' + i, price: 0.00001 * (1 + i), liq: 20000 + i * 9000, mc: 200000 + i * 60000, created: Date.now() - (i % 5 === 0 ? 40 * 60e3 : (i + 2) * 3600e3), pump: i === 7, freeze: i === 3 });
let tick = 0;
function pair(t) {
  tick++;
  const drift = t.pump ? 1.02 : 1 + Math.sin((tick + t.mint.length * 3 + t.sym.length) / 9) * 0.004 + (t.sym.endsWith('2') ? 0.003 : 0);
  t.price *= drift;
  const good = t.sym === 'MOCK12' || t.sym === 'MOCK22';
  return { chainId: 'solana', dexId: 'raydium', url: 'https://dexscreener.com/solana/' + t.pair, pairAddress: t.pair,
    baseToken: { address: t.mint, name: 'Mock Token ' + t.sym, symbol: t.sym }, quoteToken: { address: WSOL, symbol: 'SOL' },
    priceNative: '0.0000001', priceUsd: t.price.toPrecision(6),
    txns: { m5: { buys: good ? 80 : 30 + (t.sym.length * 7) % 40, sells: good ? 35 : 30 }, h1: { buys: good ? 700 : 400, sells: good ? 380 : 390 }, h6: { buys: 2000, sells: 1800 }, h24: { buys: 6000, sells: 5000 } },
    volume: { m5: good ? 15000 : 4000, h1: good ? 90000 : 40000, h6: 200000, h24: 600000 },
    priceChange: { m5: t.pump ? 65 : good ? 6.5 : ((t.sym.length * 13) % 9) - 3, h1: good ? 14 : 3, h6: good ? 22 : -2, h24: 35 },
    liquidity: { usd: t.liq, base: 1, quote: 1 }, fdv: t.mc, marketCap: t.mc, pairCreatedAt: t.created,
    info: { websites: [{ label: 'Website', url: 'https://example.org/' + t.sym }], socials: [{ type: 'twitter', url: 'https://x.com/' + t.sym }, { type: 'bad', url: 'javascript:alert(1)' }] } };
}
function route(url, method, body) {
  const u = new URL(url);
  if (u.host === 'api.dexscreener.com') {
    if (u.pathname.startsWith('/token-profiles') || u.pathname.startsWith('/token-boosts')) return tokens.slice(0, 25).map(t => ({ chainId: 'solana', tokenAddress: t.mint, url: 'https://dexscreener.com/solana/' + t.mint, links: [{ type: 'telegram', url: 'https://t.me/' + t.sym }] })).concat([{ chainId: 'ethereum', tokenAddress: '0xabc' }]);
    if (u.pathname.startsWith('/tokens/v1/solana/')) {
      const ms = decodeURIComponent(u.pathname.split('/').pop()).split(',');
      if (ms.length === 1 && ms[0] === WSOL) return [{ chainId: 'solana', dexId: 'raydium', pairAddress: mint(5000), baseToken: { address: WSOL, symbol: 'SOL', name: 'Wrapped SOL' }, quoteToken: { address: USDC, symbol: 'USDC' }, priceUsd: '151.23', liquidity: { usd: 9e6 }, volume: {}, txns: {}, priceChange: { h1: 0.4, h24: 1.2 } }];
      return tokens.filter(t => ms.includes(t.mint)).map(pair);
    }
    return [];
  }
  if (u.host === 'api.geckoterminal.com') {
    if (u.pathname.includes('/ohlcv/')) { const list = []; let p = 0.0002, now = Math.floor(Date.now() / 60000) * 60; for (let i = 0; i < 300; i++) { const o = p; p = p * (1 + Math.sin(i / 11) * 0.01 + (i % 40 === 20 ? 0.05 : 0)); list.push([now - i * 60, o, Math.max(o, p) * 1.01, Math.min(o, p) * 0.99, p, 500 + (i % 40 === 20 ? 6000 : 0)]); } return { data: { attributes: { ohlcv_list: list } } }; }
    if (u.pathname.includes('/pools/multi/')) { const ps = u.pathname.split('/').pop().split(','); return { data: tokens.filter(t => ps.includes(t.pair)).map(t => ({ id: 'solana_' + t.pair, type: 'pool', attributes: { name: t.sym + ' / SOL', address: t.pair, base_token_price_usd: String(t.price * 1.004), reserve_in_usd: String(t.liq * 1.05), fdv_usd: String(t.mc), market_cap_usd: String(t.mc), price_change_percentage: { m5: '1', h1: '2', h6: '3', h24: '4' }, transactions: { m5: { buys: 10, sells: 8 }, h1: { buys: 100, sells: 90 } }, volume_usd: { m5: '1000', h1: '20000', h24: '500000' }, pool_created_at: new Date(t.created).toISOString() }, relationships: { base_token: { data: { id: 'solana_' + t.mint } }, dex: { data: { id: 'raydium' } } } })) }; }
    return { data: tokens.slice(30, 36).map(t => ({ id: 'solana_' + t.pair, type: 'pool', attributes: { name: t.sym + ' / SOL', address: t.pair, base_token_price_usd: String(t.price), reserve_in_usd: String(t.liq), fdv_usd: String(t.mc), market_cap_usd: null, price_change_percentage: { m5: '1', h1: '2' }, transactions: { m5: { buys: 10, sells: 8 }, h1: { buys: 100, sells: 90 } }, volume_usd: { m5: '1000', h1: '20000' }, pool_created_at: new Date(t.created).toISOString() }, relationships: { base_token: { data: { id: 'solana_' + t.mint } } } })) };
  }
  if (u.host === 'api.rugcheck.xyz') { const m = u.pathname.split('/')[3]; const t = tokens.find(x => x.mint === m); return { score: 101, score_normalised: 3, risks: t && t.freeze ? [{ name: 'Freeze Authority still enabled', level: 'danger', value: '', description: 'x', score: 5000 }] : [{ name: 'Low amount of LP Providers', level: 'warn', value: '', description: '', score: 400 }], lpLockedPct: 100 }; }
  if (method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (b.method === 'getSlot') return { jsonrpc: '2.0', id: 1, result: 312345678 + Math.floor(Date.now() / 400) % 1000 };
    if (b.method === 'getAccountInfo') { const t = tokens.find(x => x.mint === b.params[0]); return { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: { program: 'spl-token', parsed: { type: 'mint', info: { decimals: 6, supply: '1000000000000000', isInitialized: true, mintAuthority: null, freezeAuthority: t && t.freeze ? mint(9999) : null } } } } } }; }
    if (b.method === 'getTokenLargestAccounts') return { jsonrpc: '2.0', id: 1, result: { value: Array.from({ length: 12 }, (_, i) => ({ address: mint(7000 + i), amount: String(30000000000000 - i * 1000000000000), decimals: 6 })) } };
    return { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } };
  }
  return null;
}
module.exports = { route, tokens };
