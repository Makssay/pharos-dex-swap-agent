#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");
const networksPath = path.join(skillRoot, "assets", "networks.json");
const networksConfig = JSON.parse(fs.readFileSync(networksPath, "utf8"));

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DEPOSIT_TOPIC = "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";
const MIX_SWAP_SELECTOR = "0xff84aafa";
const WPROS_DEPOSIT_SELECTOR = "0xd0e30db0";
const WPROS_WITHDRAW_SELECTOR = "0x2e1a7d4d";
const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";
const ERC20_ALLOWANCE_SELECTOR = "0xdd62ed3e";
const ERC20_BALANCE_OF_SELECTOR = "0x70a08231";
const ERC20_DECIMALS_SELECTOR = "0x313ce567";
const ERC20_SYMBOL_SELECTOR = "0x95d89b41";
const ERC20_NAME_SELECTOR = "0x06fdde03";

function parseArgs(argv) {
  const out = { format: "console", network: networksConfig.defaultNetwork || "mainnet" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    if (["wrap-pros", "unwrap-wpros", "fetch-route", "execute", "yes", "no-color", "allow-unknown-router"].includes(name)) {
      out[name] = true;
    } else {
      out[name] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function usage() {
  return `Usage:
  node scripts/swap-agent.mjs --inspect-tx <hash> [--network mainnet] [--format console|markdown|json]
  node scripts/swap-agent.mjs --wrap-pros --amount 0.1 [--network mainnet]
  node scripts/swap-agent.mjs --unwrap-wpros --amount 0.1 [--network mainnet]
  node scripts/swap-agent.mjs --fetch-route --from-token PROS --to-token USDC --amount 0.1 --wallet 0x...
  node scripts/swap-agent.mjs --route-file route.json --wallet 0x... [--network mainnet]
  node scripts/swap-agent.mjs --route-file route.json --wallet 0x... --execute --yes`;
}

function networkByName(name) {
  const net = networksConfig.networks.find((item) => item.name === name);
  if (!net) throw new Error(`Unsupported network: ${name}`);
  return net;
}

function isHex(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function normalizeAddress(value) {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
  return value.toLowerCase();
}

function shortAddress(value) {
  return value && value.length >= 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : String(value || "");
}

function hexToBigInt(value) {
  if (!value || value === "0x") return 0n;
  return BigInt(value);
}

function bigintToHex(value) {
  const v = BigInt(value);
  return `0x${v.toString(16)}`;
}

function slot(data, idx) {
  const start = 10 + idx * 64;
  return data.slice(start, start + 64);
}

function body(data) {
  return data.slice(10);
}

function wordAtBody(inputBody, byteOffset) {
  const start = Number(byteOffset) * 2;
  return inputBody.slice(start, start + 64);
}

function uintFromWord(word) {
  return BigInt(`0x${word || "0"}`);
}

function addressFromWord(word) {
  return `0x${word.slice(24).toLowerCase()}`;
}

function topicAddress(topic) {
  return topic && topic.length === 66 ? `0x${topic.slice(26).toLowerCase()}` : null;
}

function padUint(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function encodeAddress(address) {
  return normalizeAddress(address).slice(2).padStart(64, "0");
}

function parseUnits(value, decimals) {
  const text = String(value);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid decimal amount: ${value}. Use dot, not comma.`);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error(`Too many decimals for token with ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction.padEnd(decimals, "0") || "0"));
}

function formatUnits(value, decimals, maxFraction = 8) {
  const v = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  if (frac === 0n) return whole.toString();
  let fracText = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  if (fracText.length > maxFraction) fracText = fracText.slice(0, maxFraction);
  return `${whole}.${fracText}`;
}

async function rpc(net, method, params) {
  const res = await fetch(net.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message || JSON.stringify(json.error));
    err.rpcError = json.error;
    throw err;
  }
  return json.result;
}

async function ethCall(net, call, block = "latest") {
  return rpc(net, "eth_call", [call, block]);
}

function decodeStringResult(hex) {
  if (!hex || hex === "0x") return "";
  const data = hex.slice(2);
  try {
    const offset = Number(BigInt(`0x${data.slice(0, 64)}`));
    const len = Number(BigInt(`0x${data.slice(offset * 2, offset * 2 + 64)}`));
    const bytes = data.slice(offset * 2 + 64, offset * 2 + 64 + len * 2);
    return Buffer.from(bytes, "hex").toString("utf8");
  } catch {
    const raw = Buffer.from(data, "hex").toString("utf8").replace(/\0/g, "").trim();
    return raw || hex;
  }
}

async function tokenInfo(net, address) {
  const lower = normalizeAddress(address);
  for (const [symbol, token] of Object.entries(net.knownTokens || {})) {
    if (token.address.toLowerCase() === lower) {
      return { address: lower, symbol, name: symbol, decimals: token.decimals, known: true };
    }
  }
  const info = { address: lower, symbol: shortAddress(lower), name: shortAddress(lower), decimals: 18, known: false };
  try {
    const [name, symbol, decimals] = await Promise.all([
      ethCall(net, { to: lower, data: ERC20_NAME_SELECTOR }).catch(() => null),
      ethCall(net, { to: lower, data: ERC20_SYMBOL_SELECTOR }).catch(() => null),
      ethCall(net, { to: lower, data: ERC20_DECIMALS_SELECTOR }).catch(() => null),
    ]);
    if (name) info.name = decodeStringResult(name);
    if (symbol) info.symbol = decodeStringResult(symbol);
    if (decimals) info.decimals = Number(hexToBigInt(decimals));
  } catch {
    // Keep conservative defaults if token metadata is non-standard.
  }
  return info;
}

function resolveTokenInput(net, input) {
  if (!input) return null;
  const value = String(input).trim();
  const upper = value.toUpperCase();
  if (["PROS", "PHRS", "NATIVE", "ETH"].includes(upper) || value.toLowerCase() === net.nativeSentinel) {
    return { address: net.nativeSentinel, symbol: net.nativeToken, decimals: 18, native: true };
  }
  if ((net.knownTokens || {})[upper]) {
    const token = net.knownTokens[upper];
    return { address: token.address.toLowerCase(), symbol: upper, decimals: token.decimals, native: false };
  }
  if (isAddress(value)) return { address: value.toLowerCase(), symbol: shortAddress(value), decimals: 18, native: false };
  throw new Error(`Unknown token input: ${input}. Use a known symbol or token contract address.`);
}

function addressArrayAt(inputBody, offset) {
  const len = Number(uintFromWord(wordAtBody(inputBody, offset)));
  const values = [];
  let pos = Number(offset) + 32;
  for (let i = 0; i < len; i += 1) {
    values.push(addressFromWord(wordAtBody(inputBody, pos)));
    pos += 32;
  }
  return values;
}

function bytesAt(inputBody, offset) {
  const len = Number(uintFromWord(wordAtBody(inputBody, offset)));
  const start = (Number(offset) + 32) * 2;
  return `0x${inputBody.slice(start, start + len * 2)}`;
}

function bytesArrayAt(inputBody, offset) {
  const len = Number(uintFromWord(wordAtBody(inputBody, offset)));
  const base = Number(offset) + 32;
  const values = [];
  for (let i = 0; i < len; i += 1) {
    const rel = Number(uintFromWord(wordAtBody(inputBody, base + i * 32)));
    values.push(bytesAt(inputBody, BigInt(base + rel)));
  }
  return values;
}

function extractAddressesFromBytes(hex) {
  const out = new Set();
  const re = /000000000000000000000000([0-9a-fA-F]{40})/g;
  let match;
  while ((match = re.exec(hex.slice(2)))) {
    out.add(`0x${match[1].toLowerCase()}`);
  }
  return [...out];
}

function decodeMixSwap(input) {
  const inputBody = body(input);
  const decoded = {
    selector: MIX_SWAP_SELECTOR,
    signature: "mixSwap(address,address,uint256,uint256,uint256,address[],address[],address[],uint256,bytes[],bytes,uint256)",
    fromToken: addressFromWord(slot(input, 0)),
    toToken: addressFromWord(slot(input, 1)),
    fromTokenAmount: uintFromWord(slot(input, 2)),
    expectedReturnAmount: uintFromWord(slot(input, 3)),
    minimumReturnAmount: uintFromWord(slot(input, 4)),
    directions: uintFromWord(slot(input, 8)),
    deadline: uintFromWord(slot(input, 11)),
  };
  decoded.mixAdapters = addressArrayAt(inputBody, uintFromWord(slot(input, 5)));
  decoded.mixPairs = addressArrayAt(inputBody, uintFromWord(slot(input, 6)));
  decoded.assetTo = addressArrayAt(inputBody, uintFromWord(slot(input, 7)));
  decoded.moreInfos = bytesArrayAt(inputBody, uintFromWord(slot(input, 9))).map((item) => ({
    bytes: item,
    length: (item.length - 2) / 2,
    embeddedAddresses: extractAddressesFromBytes(item),
  }));
  decoded.feeData = bytesAt(inputBody, uintFromWord(slot(input, 10)));
  if (decoded.expectedReturnAmount > 0n && decoded.minimumReturnAmount <= decoded.expectedReturnAmount) {
    decoded.slippageBps = Number(((decoded.expectedReturnAmount - decoded.minimumReturnAmount) * 10000n) / decoded.expectedReturnAmount);
  }
  return decoded;
}

function decodeKnownInput(input) {
  if (!input || input === "0x") return { kind: "empty" };
  const selector = input.slice(0, 10).toLowerCase();
  if (selector === MIX_SWAP_SELECTOR) return { kind: "mixSwap", ...decodeMixSwap(input) };
  if (selector === WPROS_DEPOSIT_SELECTOR) return { kind: "wprosDeposit", selector, signature: "deposit()" };
  if (selector === WPROS_WITHDRAW_SELECTOR) {
    return { kind: "wprosWithdraw", selector, signature: "withdraw(uint256)", amount: uintFromWord(slot(input, 0)) };
  }
  if (selector === ERC20_APPROVE_SELECTOR) {
    return { kind: "approve", selector, signature: "approve(address,uint256)", spender: addressFromWord(slot(input, 0)), amount: uintFromWord(slot(input, 1)) };
  }
  if (selector === ERC20_TRANSFER_SELECTOR) {
    return { kind: "transfer", selector, signature: "transfer(address,uint256)", to: addressFromWord(slot(input, 0)), amount: uintFromWord(slot(input, 1)) };
  }
  return { kind: "unknown", selector, inputBytes: (input.length - 2) / 2 };
}

async function describeToken(net, address) {
  if (address.toLowerCase() === net.nativeSentinel) {
    return { address, symbol: net.nativeToken, decimals: 18, native: true };
  }
  return tokenInfo(net, address);
}

async function enrichDecoded(net, decoded) {
  if (decoded.kind !== "mixSwap") return decoded;
  const fromInfo = await describeToken(net, decoded.fromToken);
  const toInfo = await describeToken(net, decoded.toToken);
  return {
    ...decoded,
    fromTokenInfo: fromInfo,
    toTokenInfo: toInfo,
    amountInHuman: formatUnits(decoded.fromTokenAmount, fromInfo.decimals),
    expectedOutHuman: formatUnits(decoded.expectedReturnAmount, toInfo.decimals),
    minimumOutHuman: formatUnits(decoded.minimumReturnAmount, toInfo.decimals),
    deadlineIso: new Date(Number(decoded.deadline) * 1000).toISOString(),
    expired: decoded.deadline < BigInt(Math.floor(Date.now() / 1000)),
  };
}

async function inspectTransaction(net, hash) {
  const [tx, receipt, chainIdHex, latestBlockHex] = await Promise.all([
    rpc(net, "eth_getTransactionByHash", [hash]),
    rpc(net, "eth_getTransactionReceipt", [hash]),
    rpc(net, "eth_chainId", []),
    rpc(net, "eth_blockNumber", []),
  ]);
  if (!tx) throw new Error(`Transaction not found: ${hash}`);
  const decoded = await enrichDecoded(net, decodeKnownInput(tx.input));
  const transferTokens = new Set();
  const events = (receipt?.logs || []).map((log, idx) => {
    if (log.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC) {
      transferTokens.add(log.address.toLowerCase());
      return {
        index: idx,
        kind: "Transfer",
        token: log.address.toLowerCase(),
        from: topicAddress(log.topics[1]),
        to: topicAddress(log.topics[2]),
        rawAmount: hexToBigInt(log.data).toString(),
      };
    }
    if (log.topics?.[0]?.toLowerCase() === DEPOSIT_TOPIC) {
      return {
        index: idx,
        kind: "WPROS Deposit",
        token: log.address.toLowerCase(),
        to: topicAddress(log.topics[1]),
        rawAmount: hexToBigInt(log.data).toString(),
      };
    }
    return { index: idx, kind: "Log", address: log.address.toLowerCase(), topic0: log.topics?.[0] || null };
  });
  const tokenMetadata = {};
  for (const token of transferTokens) tokenMetadata[token] = await tokenInfo(net, token);
  return {
    type: "transaction-inspection",
    network: net.name,
    chainId: Number(hexToBigInt(chainIdHex)),
    latestBlock: Number(hexToBigInt(latestBlockHex)),
    explorer: `${net.explorerUrl.replace(/\/$/, "")}/tx/${hash}`,
    hash,
    status: receipt?.status === "0x1" ? "success" : receipt?.status === "0x0" ? "failed" : "unknown",
    blockNumber: receipt ? Number(hexToBigInt(receipt.blockNumber)) : null,
    from: tx.from,
    to: tx.to,
    valueWei: hexToBigInt(tx.value).toString(),
    valueHuman: `${formatUnits(hexToBigInt(tx.value), 18)} ${net.nativeToken}`,
    gasLimit: Number(hexToBigInt(tx.gas)),
    gasUsed: receipt ? Number(hexToBigInt(receipt.gasUsed)) : null,
    decoded,
    events,
    tokenMetadata,
    safety: buildSafety(decoded, net),
  };
}

function buildSafety(decoded, net) {
  const notes = [];
  if (decoded.kind === "mixSwap") {
    if (decoded.expired) notes.push({ level: "FAIL", message: "Route deadline is expired. Do not reuse this calldata." });
    else notes.push({ level: "OK", message: "Route deadline is still in the future at inspection time." });
    if (decoded.fromToken?.toLowerCase() === net.nativeSentinel) notes.push({ level: "INFO", message: `Route spends native ${net.nativeToken}; tx value must equal amount in.` });
    if (decoded.toToken?.toLowerCase() === net.nativeSentinel) notes.push({ level: "INFO", message: `Route outputs native ${net.nativeToken}.` });
    if (decoded.slippageBps !== undefined) notes.push({ level: decoded.slippageBps > 500 ? "WARN" : "OK", message: `Route slippage from expected to minimum: ${decoded.slippageBps} bps.` });
  }
  if (decoded.kind === "wprosDeposit") notes.push({ level: "OK", message: "This is a direct native PROS to WPROS wrap call." });
  if (decoded.kind === "wprosWithdraw") notes.push({ level: "OK", message: "This is a direct WPROS to native PROS unwrap call." });
  if (decoded.kind === "unknown") notes.push({ level: "WARN", message: "Unknown calldata selector. Require ABI or a known route decoder before execution." });
  notes.push({ level: "SAFE", message: "Read-only inspection uses no private key and sends no transaction." });
  return notes;
}

function findRouteCandidate(value, pathParts = []) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.to === "string" && typeof value.data === "string" && isHex(value.data)) {
    return { tx: value, path: pathParts.join(".") || "$" };
  }
  const preferred = ["tx", "transaction", "route", "result", "data"];
  for (const key of preferred) {
    if (value[key]) {
      const found = findRouteCandidate(value[key], [...pathParts, key]);
      if (found) return found;
    }
  }
  for (const [key, child] of Object.entries(value)) {
    if (preferred.includes(key)) continue;
    const found = findRouteCandidate(child, [...pathParts, key]);
    if (found) return found;
  }
  return null;
}

function findApproveTarget(value) {
  if (!value || typeof value !== "object") return null;
  for (const key of ["targetApproveAddr", "allowanceTarget", "approveTo", "approveAddr", "spender"]) {
    if (typeof value[key] === "string" && isAddress(value[key])) return value[key].toLowerCase();
  }
  for (const child of Object.values(value)) {
    const found = findApproveTarget(child);
    if (found) return found;
  }
  return null;
}

async function analyzeRouteFile(net, opts) {
  const routePath = path.resolve(opts["route-file"]);
  const raw = JSON.parse(fs.readFileSync(routePath, "utf8"));
  return analyzeRoutePayload(net, opts, raw, { routePath });
}

async function analyzeRoutePayload(net, opts, raw, source = {}) {
  const found = findRouteCandidate(raw);
  if (!found) throw new Error("No transaction-like route object found. Expected fields: to, data, value.");
  const route = found.tx;
  const to = normalizeAddress(route.to);
  const data = route.data;
  const value = route.value ?? route.valueWei ?? "0x0";
  const valueWei = typeof value === "number" ? BigInt(value) : isHex(String(value)) ? hexToBigInt(String(value)) : BigInt(String(value));
  const decoded = await enrichDecoded(net, decodeKnownInput(data));
  const approveTarget = findApproveTarget(raw) || to;
  const report = {
    type: "route-validation",
    network: net.name,
    routePath: source.routePath,
    routeSource: source.routeSource,
    routeObjectPath: found.path,
    to,
    valueWei: valueWei.toString(),
    valueHuman: `${formatUnits(valueWei, 18)} ${net.nativeToken}`,
    dataBytes: (data.length - 2) / 2,
    approveTarget,
    decoded,
    checks: [],
    unsignedTransaction: { chainId: net.chainId, to, data, value: bigintToHex(valueWei) },
  };
  await routeChecks(net, opts, report, valueWei);
  if (opts.execute) await executeRoute(net, opts, report, valueWei, raw);
  return report;
}

async function fetchRoute(net, opts) {
  if (!opts.wallet) throw new Error("--fetch-route requires --wallet so the route API can build user-specific calldata");
  const apiKey = opts["api-key"] || process.env.DODO_API_KEY || process.env.FAROSWAP_API_KEY;
  if (!apiKey) {
    throw new Error("--fetch-route requires DODO_API_KEY or FAROSWAP_API_KEY in the local environment. Do not search the web for a bypass; FaroSwap docs say developer API access is required.");
  }
  const from = resolveTokenInput(net, opts["from-token"]);
  const to = resolveTokenInput(net, opts["to-token"]);
  if (!from || !to || !opts.amount) throw new Error("--fetch-route requires --from-token, --to-token, and --amount");
  const fromInfo = from.native ? from : await describeToken(net, from.address);
  const toInfo = to.native ? to : await describeToken(net, to.address);
  const fromAmount = parseUnits(opts.amount, fromInfo.decimals);
  const apiUrl = opts["route-api"] || net.dodoRouteApiUrl || "https://api.dodoex.io/route-service/developer/getdodoroute";
  const url = new URL(apiUrl);
  url.searchParams.set("fromTokenAddress", fromInfo.address);
  url.searchParams.set("fromTokenDecimals", String(fromInfo.decimals));
  url.searchParams.set("toTokenAddress", toInfo.address);
  url.searchParams.set("toTokenDecimals", String(toInfo.decimals));
  url.searchParams.set("fromAmount", fromAmount.toString());
  url.searchParams.set("slippage", String(opts.slippage || "1"));
  url.searchParams.set("userAddr", normalizeAddress(opts.wallet));
  url.searchParams.set("chainId", String(net.chainId));
  url.searchParams.set("rpc", opts["rpc-url"] || net.rpcUrl);
  url.searchParams.set("apikey", apiKey);

  const res = await fetch(url, { headers: { "User-Agent": "Pharos-DEX-Swap-Agent" } });
  let json;
  try {
    json = await res.json();
  } catch {
    const text = await res.text().catch(() => "");
    throw new Error(`Route API returned non-JSON response (${res.status}): ${text.slice(0, 240)}`);
  }
  if (!res.ok || ![200, "200"].includes(json.status)) {
    const message = json.message || json.error || JSON.stringify(json).slice(0, 300);
    throw new Error(`Route API failed (${res.status}): ${message}`);
  }
  const raw = json.data || json.result || json;
  const routeReport = await analyzeRoutePayload(net, opts, raw, { routeSource: apiUrl });
  routeReport.type = "route-fetch-validation";
  routeReport.request = {
    fromToken: fromInfo,
    toToken: toInfo,
    amountIn: fromAmount.toString(),
    amountInHuman: `${opts.amount} ${fromInfo.symbol}`,
    slippage: String(opts.slippage || "1"),
  };
  return routeReport;
}

async function routeChecks(net, opts, report, valueWei) {
  const chainId = Number(hexToBigInt(await rpc(net, "eth_chainId", [])));
  report.checks.push(check(chainId === net.chainId, `RPC chain ID ${chainId} matches ${net.chainId}.`));
  const code = await rpc(net, "eth_getCode", [report.to, "latest"]);
  report.checks.push(check(code && code !== "0x", `Route target has bytecode: ${report.to}.`));
  if (report.to !== net.routeProxy?.toLowerCase()) {
    report.checks.push(check(Boolean(opts["allow-unknown-router"]), `Route target differs from known FaroSwap route proxy: ${report.to}.`));
  } else {
    report.checks.push({ level: "OK", message: "Route target matches known FaroSwap/DODO route proxy." });
  }
  if (report.decoded.kind === "mixSwap") {
    report.checks.push(check(!report.decoded.expired, `Route deadline: ${report.decoded.deadlineIso}.`));
    if (report.decoded.fromToken.toLowerCase() === net.nativeSentinel) {
      report.checks.push(check(valueWei === report.decoded.fromTokenAmount, `Native value equals amount in: ${formatUnits(valueWei, 18)} ${net.nativeToken}.`));
    }
  }
  if (opts.wallet) {
    const wallet = normalizeAddress(opts.wallet);
    const nativeBalance = hexToBigInt(await rpc(net, "eth_getBalance", [wallet, "latest"]));
    report.wallet = wallet;
    report.nativeBalance = `${formatUnits(nativeBalance, 18)} ${net.nativeToken}`;
    report.checks.push(check(nativeBalance >= valueWei, `Native balance covers tx value: ${report.nativeBalance}.`));
    if (report.decoded.kind === "mixSwap" && report.decoded.fromToken.toLowerCase() !== net.nativeSentinel) {
      const token = await tokenInfo(net, report.decoded.fromToken);
      const bal = hexToBigInt(await ethCall(net, { to: token.address, data: ERC20_BALANCE_OF_SELECTOR + encodeAddress(wallet) }));
      const allowanceData = ERC20_ALLOWANCE_SELECTOR + encodeAddress(wallet) + encodeAddress(report.approveTarget);
      const allowance = hexToBigInt(await ethCall(net, { to: token.address, data: allowanceData }));
      report.fromTokenBalance = `${formatUnits(bal, token.decimals)} ${token.symbol}`;
      report.allowance = `${formatUnits(allowance, token.decimals)} ${token.symbol}`;
      report.checks.push(check(bal >= report.decoded.fromTokenAmount, `ERC20 balance covers amount in: ${report.fromTokenBalance}.`));
      report.checks.push(check(allowance >= report.decoded.fromTokenAmount, `Allowance to ${shortAddress(report.approveTarget)} covers amount in: ${report.allowance}.`));
    }
    try {
      const gas = hexToBigInt(await rpc(net, "eth_estimateGas", [{ from: wallet, to: report.to, data: report.unsignedTransaction.data, value: report.unsignedTransaction.value }]));
      report.estimatedGas = gas.toString();
      report.checks.push({ level: "OK", message: `eth_estimateGas succeeded: ${gas}.` });
    } catch (err) {
      report.checks.push({ level: "WARN", message: `eth_estimateGas failed: ${err.message}` });
    }
  } else {
    report.checks.push({ level: "INFO", message: "Wallet not provided; balance, allowance, and gas checks were skipped." });
  }
}

function check(ok, message) {
  return { level: ok ? "OK" : "FAIL", message };
}

function buildWrapPlan(net, opts) {
  if (!net.wpros) throw new Error(`No WPROS address configured for ${net.name}`);
  if (!opts.amount) throw new Error("--amount is required");
  const amountWei = parseUnits(opts.amount, 18);
  return {
    type: "wrap-plan",
    network: net.name,
    action: `${net.nativeToken} -> WPROS`,
    amount: `${opts.amount} ${net.nativeToken}`,
    to: net.wpros,
    data: WPROS_DEPOSIT_SELECTOR,
    value: bigintToHex(amountWei),
    valueWei: amountWei.toString(),
    unsignedTransaction: { chainId: net.chainId, to: net.wpros, data: WPROS_DEPOSIT_SELECTOR, value: bigintToHex(amountWei) },
    checks: [{ level: "OK", message: "Direct WPROS deposit() transaction prepared. No route engine required." }],
  };
}

function buildUnwrapPlan(net, opts) {
  if (!net.wpros) throw new Error(`No WPROS address configured for ${net.name}`);
  if (!opts.amount) throw new Error("--amount is required");
  const amountWei = parseUnits(opts.amount, 18);
  return {
    type: "unwrap-plan",
    network: net.name,
    action: "WPROS -> native PROS",
    amount: `${opts.amount} WPROS`,
    to: net.wpros,
    data: WPROS_WITHDRAW_SELECTOR + padUint(amountWei),
    value: "0x0",
    valueWei: "0",
    unsignedTransaction: { chainId: net.chainId, to: net.wpros, data: WPROS_WITHDRAW_SELECTOR + padUint(amountWei), value: "0x0" },
    checks: [{ level: "OK", message: "Direct WPROS withdraw(uint256) transaction prepared. No route engine required." }],
  };
}

async function buildIntentPlan(net, opts) {
  const from = resolveTokenInput(net, opts["from-token"]);
  const to = resolveTokenInput(net, opts["to-token"]);
  if (!from || !to || !opts.amount) throw new Error("--from-token, --to-token, and --amount are required for a swap intent plan");
  const fromInfo = from.native ? from : await describeToken(net, from.address);
  const amountIn = parseUnits(opts.amount, fromInfo.decimals);
  return {
    type: "swap-intent-plan",
    network: net.name,
    fromToken: fromInfo,
    toToken: to.native ? to : await describeToken(net, to.address),
    amountIn: amountIn.toString(),
    amountInHuman: `${opts.amount} ${fromInfo.symbol}`,
    checks: [
      { level: "INFO", message: "A fresh FaroSwap/DODO route is required before this can become a transaction." },
      { level: "INFO", message: "Use --route-file with copied route JSON/calldata to validate, simulate, and optionally execute." },
      { level: "SAFE", message: "No route was built and no transaction was sent." },
    ],
  };
}

async function executeRoute(net, opts, report, valueWei, rawRoute) {
  if (!opts.yes) throw new Error("--execute requires --yes");
  if (!process.env.PRIVATE_KEY) throw new Error("--execute requires PRIVATE_KEY in the local environment");
  let ethers;
  try {
    ethers = await import("ethers");
  } catch {
    throw new Error("Execution requires the ethers package. Run npm install ethers in the current project or use validation-only mode.");
  }
  const provider = new ethers.JsonRpcProvider(net.rpcUrl, net.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  if (opts.wallet && wallet.address.toLowerCase() !== normalizeAddress(opts.wallet)) {
    throw new Error(`Signer address ${wallet.address} does not match --wallet ${opts.wallet}`);
  }
  const decoded = report.decoded;
  const sent = [];
  if (decoded.kind === "mixSwap" && decoded.fromToken.toLowerCase() !== net.nativeSentinel) {
    const spender = report.approveTarget || findApproveTarget(rawRoute) || report.to;
    const erc20 = new ethers.Contract(decoded.fromToken, [
      "function allowance(address owner,address spender) view returns (uint256)",
      "function approve(address spender,uint256 amount) returns (bool)",
    ], wallet);
    const allowance = await erc20.allowance(wallet.address, spender);
    if (allowance < decoded.fromTokenAmount) {
      const approveTx = await erc20.approve(spender, decoded.fromTokenAmount);
      sent.push({ kind: "approve", hash: approveTx.hash, explorer: `${net.explorerUrl.replace(/\/$/, "")}/tx/${approveTx.hash}` });
      await approveTx.wait();
    }
  }
  const tx = await wallet.sendTransaction({
    to: report.to,
    data: report.unsignedTransaction.data,
    value: valueWei,
  });
  sent.push({ kind: "swap", hash: tx.hash, explorer: `${net.explorerUrl.replace(/\/$/, "")}/tx/${tx.hash}` });
  const receipt = await tx.wait();
  report.execution = { status: receipt.status, transactions: sent };
}

function linesForDecoded(decoded, net) {
  if (decoded.kind === "mixSwap") {
    return [
      `Method: ${decoded.signature}`,
      `From token: ${decoded.fromTokenInfo?.symbol || decoded.fromToken} (${decoded.fromToken})`,
      `To token: ${decoded.toTokenInfo?.symbol || decoded.toToken} (${decoded.toToken})`,
      `Amount in: ${decoded.amountInHuman || decoded.fromTokenAmount}`,
      `Expected out: ${decoded.expectedOutHuman || decoded.expectedReturnAmount}`,
      `Minimum out: ${decoded.minimumOutHuman || decoded.minimumReturnAmount}`,
      `Slippage: ${decoded.slippageBps ?? "unknown"} bps`,
      `Deadline: ${decoded.deadlineIso || decoded.deadline}${decoded.expired ? " (expired)" : ""}`,
      `Adapters: ${decoded.mixAdapters.map(shortAddress).join(", ") || "none"}`,
      `Pairs: ${decoded.mixPairs.map(shortAddress).join(", ") || "none"}`,
      `Asset receivers: ${decoded.assetTo.map(shortAddress).join(", ") || "none"}`,
    ];
  }
  if (decoded.kind === "wprosDeposit") return [`Method: WPROS deposit()`, `Meaning: native ${net.nativeToken} -> WPROS`];
  if (decoded.kind === "wprosWithdraw") return [`Method: WPROS withdraw(uint256)`, `Amount: ${formatUnits(decoded.amount, 18)} WPROS`];
  if (decoded.kind === "approve") return [`Method: ERC20 approve(address,uint256)`, `Spender: ${decoded.spender}`, `Raw amount: ${decoded.amount}`];
  if (decoded.kind === "transfer") return [`Method: ERC20 transfer(address,uint256)`, `To: ${decoded.to}`, `Raw amount: ${decoded.amount}`];
  return [`Method: ${decoded.kind}`, decoded.selector ? `Selector: ${decoded.selector}` : ""].filter(Boolean);
}

function renderConsole(report, net) {
  const out = [];
  out.push("PHAROS DEX SWAP AGENT");
  out.push(`Network: ${report.network || net.name} | chain ${net.chainId} | ${net.nativeToken}`);
  out.push("");
  if (report.type === "transaction-inspection") {
    out.push(`Transaction: ${report.hash}`);
    out.push(`Explorer: ${report.explorer}`);
    out.push(`Status: ${report.status}`);
    out.push(`From: ${report.from}`);
    out.push(`To: ${report.to}`);
    out.push(`Value: ${report.valueHuman}`);
    out.push(`Gas: ${report.gasUsed}/${report.gasLimit}`);
    out.push("");
    out.push("Decoded");
    out.push(...linesForDecoded(report.decoded, net).map((line) => `- ${line}`));
    out.push("");
    out.push("Events");
    for (const event of report.events || []) {
      if (event.kind === "Transfer") {
        const token = report.tokenMetadata?.[event.token];
        const amount = token ? `${formatUnits(event.rawAmount, token.decimals)} ${token.symbol}` : event.rawAmount;
        out.push(`- Transfer ${amount}: ${shortAddress(event.from)} -> ${shortAddress(event.to)} (${shortAddress(event.token)})`);
      } else if (event.kind === "WPROS Deposit") {
        out.push(`- WPROS Deposit ${formatUnits(event.rawAmount, 18)} ${net.nativeToken}: ${shortAddress(event.to)}`);
      }
    }
  } else {
    out.push(`Type: ${report.type}`);
    if (report.action) out.push(`Action: ${report.action}`);
    if (report.amount) out.push(`Amount: ${report.amount}`);
    if (report.type === "swap-intent-plan") {
      out.push(`From token: ${report.fromToken.symbol} (${report.fromToken.address})`);
      out.push(`To token: ${report.toToken.symbol} (${report.toToken.address})`);
      out.push(`Amount in: ${report.amountInHuman}`);
    }
    if (report.routePath) out.push(`Route file: ${report.routePath}`);
    if (report.to) out.push(`To: ${report.to}`);
    if (report.valueHuman) out.push(`Value: ${report.valueHuman}`);
    if (report.wallet) out.push(`Wallet: ${report.wallet}`);
    if (report.nativeBalance) out.push(`Native balance: ${report.nativeBalance}`);
    if (report.fromTokenBalance) out.push(`From-token balance: ${report.fromTokenBalance}`);
    if (report.allowance) out.push(`Allowance: ${report.allowance}`);
    if (report.decoded) {
      out.push("");
      out.push("Decoded");
      out.push(...linesForDecoded(report.decoded, net).map((line) => `- ${line}`));
    }
    if (report.unsignedTransaction) {
      out.push("");
      out.push("Unsigned transaction");
      out.push(`- chainId: ${report.unsignedTransaction.chainId}`);
      out.push(`- to: ${report.unsignedTransaction.to}`);
      out.push(`- value: ${report.unsignedTransaction.value}`);
      out.push(`- data bytes: ${(report.unsignedTransaction.data.length - 2) / 2}`);
    }
  }
  const checks = report.checks || report.safety || [];
  if (checks.length) {
    out.push("");
    out.push("Checks");
    for (const item of checks) out.push(`- [${item.level}] ${item.message}`);
  }
  if (report.execution) {
    out.push("");
    out.push("Execution");
    out.push(`- Status: ${report.execution.status}`);
    for (const tx of report.execution.transactions) out.push(`- ${tx.kind}: ${tx.hash}`);
  }
  out.push("");
  out.push("No private keys are used unless --execute --yes is explicitly set.");
  return out.join("\n");
}

function renderMarkdown(report, net) {
  return `# Pharos DEX Swap Agent Report

${renderConsole(report, net)
    .split("\n")
    .map((line) => (line.startsWith("- ") ? line : line))
    .join("\n")}
`;
}

function render(report, net, format) {
  if (format === "json") {
    return JSON.stringify(report, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2);
  }
  if (format === "markdown") return renderMarkdown(report, net);
  return renderConsole(report, net);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const net = networkByName(opts.network);
  let report;
  if (opts["inspect-tx"]) report = await inspectTransaction(net, opts["inspect-tx"]);
  else if (opts["route-file"]) report = await analyzeRouteFile(net, opts);
  else if (opts["fetch-route"]) report = await fetchRoute(net, opts);
  else if (opts["wrap-pros"]) report = buildWrapPlan(net, opts);
  else if (opts["unwrap-wpros"]) report = buildUnwrapPlan(net, opts);
  else if (opts["from-token"] || opts["to-token"]) report = await buildIntentPlan(net, opts);
  else throw new Error(usage());

  const output = render(report, net, opts.format);
  if (opts.output) fs.writeFileSync(path.resolve(opts.output), output, "utf8");
  console.log(output);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
