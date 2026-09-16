# SurDream Web

A non-custodial DeFi asset management frontend. Connect a browser wallet, compare yields across
staking, stablecoin and lending protocols, and sign every transaction locally — the app never holds
keys and never takes custody of funds.

## Features

| Page | Route | What it does |
| --- | --- | --- |
| Home | `/` | Landing page and protocol overview |
| Stake | `/stake` | Liquid staking — stake, unstake, wrap, claim, boost |
| Stablecoins | `/stablecoins` | Stablecoin yield — deposit, withdraw, claim |
| Lending | `/lending` | Supply, borrow, repay and withdraw against collateral |
| Portfolio | `/portfolio` | Aggregated positions, earnings, health factor and transaction history |
| RWA | `/rwa` | Tokenised real-world assets |

### Supported protocols

**Staking** — Lido, Rocket Pool, mETH, Stader, StakeWise, ether.fi

**Stablecoins** — Ethena, Curve

**Lending** — Aave, Compound, Morpho, SparkLend, Fluid

## Tech stack

Vue 3 + Vite, Vue Router, Pinia, wagmi / Reown AppKit, viem, Tailwind CSS. Ledger hardware wallets
are supported over WebHID.

## Requirements

- Node.js `^20.19.0 || >=22.12.0` (see `.nvmrc`)
- A browser wallet extension (MetaMask, OKX, Coinbase Wallet, …) or WalletConnect

## Getting started

```sh
yarn install     # postinstall applies patches/ via patch-package
yarn dev         # start the dev server
yarn build       # production build into dist/
yarn preview     # preview the production build locally
```

### Environment variables

Copy `.env.example` to `.env` and fill in what you need. Everything is optional except the
WalletConnect project ID, and the app falls back to public RPC endpoints when nothing is set.

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Backend API base URL | `https://api.surdream.com` |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project ID; required for WalletConnect connections | *(none)* |
| `VITE_ETHEREUM_RPC_URL` | Ethereum mainnet RPC. Accepts a **comma-separated list** — requests are spread across the pool so one dead endpoint degrades only a fraction of reads | `https://ethereum.publicnode.com` |
| `VITE_ARBITRUM_RPC_URL` | Arbitrum One RPC | `https://arb1.arbitrum.io/rpc` |
| `VITE_OPTIMISM_RPC_URL` | Optimism RPC | `https://mainnet.optimism.io` |

Get a WalletConnect project ID at [cloud.reown.com](https://cloud.reown.com).

> Reads default to `ethereum.publicnode.com`, a rate-limited public endpoint. For anything beyond
> light testing, point `VITE_ETHEREUM_RPC_URL` at your own node or provider key.

## Notes

- **Not audited.** This code is provided as-is for reference and self-hosting. Review it, and use it
  with your own risk controls, before putting real funds behind it.
- Default endpoints point at SurDream's production API. Self-hosting means pointing
  `VITE_API_BASE_URL` at your own backend.
- `patches/` holds a `patch-package` fix for `@reown/appkit-adapter-wagmi`, applied automatically on
  `postinstall` — do not delete it.
