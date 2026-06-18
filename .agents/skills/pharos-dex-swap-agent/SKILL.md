---
name: pharos-dex-swap-agent
description: Plan, inspect, validate, and optionally execute guarded token swaps on Pharos DEX routes. Use when a user asks an AI agent to swap Pharos tokens, inspect a FaroSwap/DODO route transaction, decode mixSwap calldata, wrap or unwrap native PROS to WPROS, swap to native PROS, check balances/allowances/slippage/deadlines, prepare unsigned swap transactions, or execute a route only after explicit confirmation and a local PRIVATE_KEY.
---

# Pharos DEX Swap Agent

Use this skill for Pharos token swap workflows. Keep read-only analysis separate from signer-capable execution.

## Safety Rules

- Always load Pharos network constants from this skill or `pharos-skill-engine`.
- Default to `mainnet` for FaroSwap route analysis unless the user specifies another network.
- Never ask the user to paste a private key into chat.
- Use `PRIVATE_KEY` only from the local environment when execution is explicitly requested.
- Do not execute a swap unless the user explicitly requests execution and the command includes `--execute --yes`.
- For mainnet swaps, show token addresses, amount in, minimum amount out, deadline, router, value, allowance target, and gas estimate before any write.
- Do not invent a FaroSwap quote. If route calldata is missing, ask for a route JSON/API response or tell the user to fetch a fresh route from FaroSwap/DODO.
- Do not browse the web to discover route endpoints during execution. The official DODO developer route endpoint requires API access. Use `--fetch-route` only when `DODO_API_KEY` or `FAROSWAP_API_KEY` is set locally.
- Treat expired route deadlines, unknown routers, stale calldata, insufficient allowance, insufficient balance, and high slippage as blockers unless the user explicitly overrides safe defaults.
- If `ethers` is missing and execution is requested, install it in the current project with `npm install ethers --no-audit --no-fund` before using `--execute --yes`.

## Quick Start

Run the bundled script from the skill root:

```powershell
node scripts/swap-agent.mjs --inspect-tx 0xa6fe8b8baeb969b162b0d8158bd463abd9d0c01ed28acfbcd979e017c37b1a4c --network mainnet --format console
```

Prepare a direct PROS -> WPROS wrap transaction:

```powershell
node scripts/swap-agent.mjs --wrap-pros --amount 0.1 --network mainnet --format console
```

Prepare a WPROS -> PROS unwrap transaction:

```powershell
node scripts/swap-agent.mjs --unwrap-wpros --amount 0.1 --network mainnet --format console
```

Validate a FaroSwap/DODO route JSON before execution:

```powershell
node scripts/swap-agent.mjs --route-file route.json --wallet 0xYourWallet --network mainnet --format console
```

Fetch and validate a fresh route through the official DODO developer route API when `DODO_API_KEY` or `FAROSWAP_API_KEY` is set:

```powershell
node scripts/swap-agent.mjs --fetch-route --from-token PROS --to-token USDC --amount 0.1 --wallet 0xYourWallet --network mainnet --format console
```

Execute only after review:

```powershell
$env:PRIVATE_KEY="local_private_key_here"
node scripts/swap-agent.mjs --route-file route.json --wallet 0xYourWallet --network mainnet --execute --yes
```

## Workflow

1. Classify the request:
   - Transaction inspection: use `--inspect-tx`.
   - Native wrapping: use `--wrap-pros`.
   - Native unwrapping: use `--unwrap-wpros`.
   - Swap from route calldata: use `--route-file`.
   - Swap by token contract without route data: use `--fetch-route` if a route API key exists; otherwise produce a plan and request `DODO_API_KEY`, `FAROSWAP_API_KEY`, or a fresh route JSON.
2. Decode known calldata:
   - `0xff84aafa`: `mixSwap(address,address,uint256,uint256,uint256,address[],address[],address[],uint256,bytes[],bytes,uint256)`.
   - `0xd0e30db0`: WPROS `deposit()`.
   - `0x2e1a7d4d`: WPROS `withdraw(uint256)`.
   - `0x095ea7b3`: ERC20 `approve(address,uint256)`.
3. Check chain ID, router bytecode, token metadata, balance, and allowance when a wallet is provided.
4. Simulate or estimate route transaction when possible.
5. For execution, require `--execute --yes`, `PRIVATE_KEY`, a route file, and a matching signer address.

## Supported Mainnet Contracts

- Native PROS sentinel in DODO/FaroSwap routes: `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`
- WPROS: `0x52c48d4213107b20bc583832b0d951fb9ca8f0b0`
- FaroSwap/DODO route proxy observed from successful swaps: `0xa5ca5fbe34e444f366b373170541ec6902b0f75c`
- USDC observed from successful swap logs: `0xc879c018db60520f4355c26ed1a6d572cdac1815`

## References

Read `references/swap-workflow.md` when the user asks how swaps are planned, why route calldata is required, or how native PROS differs from WPROS.

Read `references/examples.md` when the user asks for test commands or AI-agent prompts.
