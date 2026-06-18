# Pharos DEX Swap Agent

Plan, inspect, validate, and optionally execute guarded token swaps on Pharos.

This skill helps AI agents understand FaroSwap/DODO route transactions, decode swap calldata, validate route safety, prepare WPROS wrap/unwrap transactions, and execute a prebuilt route only after explicit confirmation.

## Why This Matters

Token swaps are high-risk onchain actions: stale routes, expired deadlines, wrong token contracts, bad slippage, missing allowance, or wrong native value can waste funds. This skill gives Pharos agents a safety layer before a swap is sent.

## Capabilities

- Inspect real Pharos swap transactions by hash.
- Decode FaroSwap/DODO `mixSwap(...)` calldata.
- Identify `fromToken`, `toToken`, amount in, expected amount out, minimum amount out, route deadline, adapters, pairs, and transfer events.
- Detect native PROS route sentinel `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`.
- Prepare direct `PROS -> WPROS` wrap transactions.
- Prepare direct `WPROS -> PROS` unwrap transactions.
- Validate route JSON from FaroSwap/DODO before execution.
- Fetch a fresh route from the official DODO developer route API when `DODO_API_KEY` or `FAROSWAP_API_KEY` is set locally.
- Check router bytecode, chain ID, route deadline, native balance, ERC20 balance, allowance, and gas estimate when a wallet is provided.
- Execute only with `--execute --yes` and a local `PRIVATE_KEY`.

## Current Scope

Directly supported:

- Pharos mainnet
- Native `PROS`
- `WPROS`
- Observed FaroSwap/DODO route proxy
- Known `USDC`
- Any ERC20 token address when a fresh route JSON/calldata is provided

Important: this skill does not invent FaroSwap routes. For normal token swaps, provide fresh route JSON/calldata from FaroSwap/DODO or set `DODO_API_KEY` / `FAROSWAP_API_KEY` so the skill can call the official developer route API. Wrap/unwrap WPROS does not need a route.

The official route API endpoint is:

```text
https://api.dodoex.io/route-service/developer/getdodoroute
```

It requires developer API access. If no API key is available, the skill should stop and ask for a route JSON/API key instead of searching for private frontend endpoints.

## Install

```powershell
npx skills add https://github.com/Makssay/pharos-dex-swap-agent
```

## Usage

Inspect a real `PROS -> USDC` swap:

```powershell
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --inspect-tx 0xa6fe8b8baeb969b162b0d8158bd463abd9d0c01ed28acfbcd979e017c37b1a4c --network mainnet --format console
```

Inspect a `PROS -> WPROS` wrap:

```powershell
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --inspect-tx 0x8eba0aa60b44f6a906ab09d3c1da4070ae6eebcebc1a811380ac07ea2528b5bb --network mainnet --format console
```

Prepare a wrap transaction:

```powershell
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --wrap-pros --amount 0.5 --network mainnet --format console
```

Prepare an unwrap transaction:

```powershell
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --unwrap-wpros --amount 0.5 --network mainnet --format console
```

Plan a token swap by contract address:

```powershell
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --from-token PROS --to-token 0xc879c018db60520f4355c26ed1a6d572cdac1815 --amount 0.1 --network mainnet --format console
```

Fetch and validate a route with API key:

```powershell
$env:DODO_API_KEY="developer_api_key_here"
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --fetch-route --from-token PROS --to-token USDC --amount 0.1 --wallet 0xYourWallet --network mainnet --format console
```

Validate a fresh route JSON:

```powershell
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --route-file route.json --wallet 0xYourWallet --network mainnet --format console
```

Execute after review:

```powershell
$env:PRIVATE_KEY="local_private_key_here"
npm install ethers --no-audit --no-fund
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --route-file route.json --wallet 0xYourWallet --network mainnet --execute --yes
```

## AI Agent Prompt

```text
Use $pharos-dex-swap-agent to inspect this Pharos mainnet swap transaction:
0xa6fe8b8baeb969b162b0d8158bd463abd9d0c01ed28acfbcd979e017c37b1a4c

Decode the route, identify fromToken/toToken, amount in, minimum amount out, deadline, router, native value, and transfer events. Do not use a private key.
```

## Safety

Read-only inspection never uses private keys. Execution is gated behind `--execute --yes`, a local `PRIVATE_KEY`, route validation, and explicit user confirmation. Do not reuse expired route calldata.
