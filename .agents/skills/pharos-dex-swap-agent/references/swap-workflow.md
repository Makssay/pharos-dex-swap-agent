# Pharos DEX Swap Workflow

## Native PROS vs WPROS

Native PROS is not an ERC20 contract. FaroSwap/DODO route calldata uses the native sentinel:

```text
0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
```

WPROS is the wrapped ERC20 version:

```text
0x52c48d4213107b20bc583832b0d951fb9ca8f0b0
```

Direct wrap:

- Target: WPROS
- Method: `deposit()`
- Selector: `0xd0e30db0`
- Native value: amount of PROS

Direct unwrap:

- Target: WPROS
- Method: `withdraw(uint256)`
- Selector: `0x2e1a7d4d`
- Argument: WPROS amount in base units

## FaroSwap/DODO route swaps

Observed successful Pharos mainnet swaps use route proxy:

```text
0xa5ca5fbe34e444f366b373170541ec6902b0f75c
```

Observed selector:

```text
0xff84aafa
mixSwap(address,address,uint256,uint256,uint256,address[],address[],address[],uint256,bytes[],bytes,uint256)
```

This calldata is route-engine output. Do not recreate it by hand from only token addresses. Require a fresh route JSON/API response or copied transaction calldata.

Official FaroSwap documentation points developers to the DODO developer route API:

```text
https://api.dodoex.io/route-service/developer/getdodoroute
```

The endpoint requires developer API access. Use `DODO_API_KEY` or `FAROSWAP_API_KEY` from the local environment. If no API key is available, do not search for bypasses or private frontend endpoints; ask the user for an API key or route JSON.

## Required preflight checks

- Chain ID matches selected network.
- Router has bytecode.
- Deadline is not expired.
- `fromToken`, `toToken`, amount in, expected out, minimum out, route proxy, and native value are visible.
- Native balance is enough for value plus gas.
- ERC20 balance is enough when `fromToken` is not native.
- ERC20 allowance is enough for the route approve target when `fromToken` is not native.
- Simulate or estimate the route transaction before execution when a wallet address is available.

## Route JSON shape

The script accepts any JSON object containing a nested transaction-like object:

```json
{
  "to": "0xa5ca5fbe34e444f366b373170541ec6902b0f75c",
  "data": "0xff84aafa...",
  "value": "0x0",
  "targetApproveAddr": "0x..."
}
```

It also searches common fields such as `tx`, `transaction`, `data.tx`, `route`, `result`, `allowanceTarget`, `approveTo`, and `targetApproveAddr`.

## Fetch route with API key

```powershell
$env:DODO_API_KEY="developer_api_key_here"
node scripts/swap-agent.mjs --fetch-route --from-token PROS --to-token USDC --amount 0.1 --wallet 0xYourWallet --network mainnet --format console
```

The script sends:

- `fromTokenAddress`
- `fromTokenDecimals`
- `toTokenAddress`
- `toTokenDecimals`
- `fromAmount`
- `slippage`
- `userAddr`
- `chainId`
- `rpc`
- `apikey`

## Execution posture

Execution is intentionally gated. A route may move real funds on mainnet. Execute only when:

- route data is fresh,
- the decoded route matches the user intent,
- slippage and deadline are acceptable,
- wallet checks pass,
- `PRIVATE_KEY` is set locally,
- command includes `--execute --yes`.
