# Examples

## Inspect the user's successful PROS to USDC swap

```powershell
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --inspect-tx 0xa6fe8b8baeb969b162b0d8158bd463abd9d0c01ed28acfbcd979e017c37b1a4c --network mainnet --format console
```

## Inspect the user's WPROS wrap transaction

```powershell
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --inspect-tx 0x8eba0aa60b44f6a906ab09d3c1da4070ae6eebcebc1a811380ac07ea2528b5bb --network mainnet --format console
```

## Prepare a WPROS wrap

```powershell
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --wrap-pros --amount 0.1 --network mainnet --format console
```

## Prepare a WPROS unwrap

```powershell
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --unwrap-wpros --amount 0.1 --network mainnet --format console
```

## Validate route JSON

```powershell
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --route-file route.json --wallet 0xf337687dD73c1A13EFE39393a000f55a95B1ac54 --network mainnet --format console
```

## Fetch route with DODO developer API key

```powershell
$env:DODO_API_KEY="developer_api_key_here"
node .\.agents\skills\pharos-dex-swap-agent\scripts\swap-agent.mjs --fetch-route --from-token PROS --to-token USDC --amount 0.1 --wallet 0xf337687dD73c1A13EFE39393a000f55a95B1ac54 --network mainnet --format console
```

## AI-agent prompt

```text
Use $pharos-dex-swap-agent to inspect this Pharos mainnet swap transaction:
0xa6fe8b8baeb969b162b0d8158bd463abd9d0c01ed28acfbcd979e017c37b1a4c

Decode the route, identify fromToken/toToken, amount in, minimum amount out, deadline, router, native value, and transfer events. Do not use a private key.
```

## AI-agent route prompt

```text
Use $pharos-dex-swap-agent to swap 0.1 PROS to USDC on Pharos mainnet.

Use the official DODO developer route API only if DODO_API_KEY or FAROSWAP_API_KEY is already set locally. Do not browse the web for private endpoints. If no API key and no route.json exist, stop and ask me for a route JSON/API key.

Before execution, show fromToken, toToken, amount in, minOut, deadline, route target, value, balance, gas estimate, and whether ethers is installed. Execute only after route validation and explicit confirmation.
```

## Execution prompt

```text
Use $pharos-dex-swap-agent to validate route.json for a Pharos mainnet swap.

Wallet: 0x...
Network: mainnet

First show decoded route, balance, allowance, deadline, slippage, and simulation result. Do not execute unless I explicitly confirm execution.
```
