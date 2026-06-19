# 🌊 WalRights

**The first programmable content licensing protocol on Sui.**
Upload to Walrus. Mint on-chain rights. Earn instantly.

[![Live App](https://img.shields.io/badge/Live%20App-walrights.pages.dev-2dd4bf?style=for-the-badge)](https://walrights.pages.dev/)
[![Built on Sui](https://img.shields.io/badge/Built%20on-Sui-6fbcf0?style=for-the-badge)](https://sui.io)
[![Storage by Walrus](https://img.shields.io/badge/Storage-Walrus-00aeef?style=for-the-badge)](https://walrus.site)

---

## ✨ What is WalRights?

WalRights turns media licensing into pure math instead of paperwork. Creators upload their work to **Walrus** decentralized storage, mint a **MasterRights** object on **Sui** that proves ownership, and list license terms for anyone to buy — streaming, sync, print, broadcast, or remix. The moment a buyer pays, SUI flows straight to the creator's wallet and a verifiable **License** object lands in the buyer's. No platform in the middle. No 90-day payout cycles. No takedown forms.

Access control is enforced by **Seal**: content stays encrypted, and decryption keys are only released if an on-chain check — *"does this wallet hold a valid, unexpired license for this content?"* — passes. No admin override exists. If the license is valid, the content unlocks. If it isn't, it doesn't.

> 🔗 **Try it live:** [walrights.pages.dev](https://walrights.pages.dev/)

---

## 🧠 How it works

```
Creator                          Buyer
  │                                │
  ├─ 1. Upload file to Walrus      │
  ├─ 2. mint_rights()  ──────► MasterRights (on-chain proof of ownership)
  ├─ 3. create_listing() ────► LicenseListing (price, type, duration)
  │                                │
  │                          4. buy_license() ──► SUI sent to creator instantly
  │                                              ──► License minted to buyer
  │                                │
  │                          5. seal_approve() gatekeeps decryption
  │                             ✅ valid license  → content decrypts
  │                             ❌ expired/missing → access denied
```

---

## 🏗️ Architecture

| Layer | Tech | Role |
|---|---|---|
| **Smart Contract** | [Sui Move](https://docs.sui.io/concepts/sui-move-concepts) | Mints rights, manages listings, issues & validates licenses |
| **Storage** | [Walrus](https://www.walrus.xyz/) | Decentralized blob storage for the actual media files |
| **Access Control** | [Seal](https://github.com/MystenLabs/seal) | On-chain–gated encryption — `seal_approve` is the sole gatekeeper |
| **Frontend** | TypeScript | The web app at [walrights.pages.dev](https://walrights.pages.dev/) |
| **Scripts** | TypeScript (`tsx`) + `@mysten/sui` SDK | CLI tooling to mint, list, buy, and upload from the terminal |

### On-chain objects

- **`MasterRights`** — the source of truth. Holds the title, content hash, Walrus blob ID, and royalty rate (in basis points). Minted once by the creator.
- **`LicenseListing`** — a shared object the creator publishes to sell a specific license type at a specific price and duration. Can be toggled on/off at any time.
- **`License`** — the proof-of-purchase NFT-like object that lives in the buyer's wallet, with an expiry timestamp (or `0` for perpetual).

### License types

| Type | Code |
|---|---|
| Streaming | `0` |
| Sync | `1` |
| Print | `2` |
| Broadcast | `3` |
| Remix | `4` |

---

## 📂 Repository structure

```
walrights/
├── contracts/          # Sui Move smart contract
│   ├── Move.toml
│   └── sources/
│       └── walrights.move
├── frontend/            # Web app (deployed to Cloudflare Pages)
├── scripts/             # CLI scripts to interact with the contract
│   ├── upload.ts        # Upload content to Walrus
│   ├── mint_rights.ts   # Mint MasterRights for a piece of content
│   ├── create_license.ts # Publish a LicenseListing
│   └── buy_license.ts   # Purchase a license
├── package.json
└── .gitignore
```

---

## 📦 Deployed contracts (Testnet)

| Resource | ID |
|---|---|
| **Package ID** | `0xc1b6baf4d46394954d31098eaf1c71283617ab81a084134288bb5d6c4ae738d8` |
| **Demo Listing ID** | `0x2ae9df975c7ba16579503135b9ae086e9b7699eebf18e26d3c10cb22da7dcb83` |
| **Clock Object** | `0x0000000000000000000000000000000000000000000000000000000000000006` |
| **`License` type** | `<PACKAGE_ID>::walrights::License` |
| **`MasterRights` type** | `<PACKAGE_ID>::walrights::MasterRights` |

**Walrus testnet endpoints:**

| Endpoint | URL |
|---|---|
| Publisher | `https://publisher.walrus-testnet.walrus.space` |
| Aggregator | `https://aggregator.walrus-testnet.walrus.space` |

> These are wired up in the frontend (`frontend/`) so the live app at [walrights.pages.dev](https://walrights.pages.dev/) talks directly to this package — no backend server, no API keys.

---

## 🚀 Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) with a configured keystore
- A funded Sui **testnet** wallet ([faucet](https://docs.sui.io/guides/developer/getting-started/get-coins))

### Installation

```bash
git clone https://github.com/RenuSri2/walrights.git
cd walrights
npm install
```

### Deploying the contract

```bash
cd contracts
sui client publish --gas-budget 100000000
```

Copy the resulting **Package ID** into the scripts (currently set in `scripts/mint_rights.ts`).

### Using the CLI scripts

```bash
# Upload your content to Walrus
npm run upload

# Mint on-chain master rights for your content
npm run mint

# Create a license listing (price, type, duration)
npm run list

# Buy a license as a different wallet
npm run buy
```

### Running the frontend

```bash
cd frontend
npm install
npm run dev
```

---

## 🔐 Why Seal matters

Most "Web3 licensing" demos stop at minting an NFT and call it a day — the actual file is still sitting on a public URL anyone can hit. WalRights doesn't have that gap. Content stored on Walrus is encrypted, and **`seal_approve`** in the Move contract is the *only* path to a decryption key. It checks license ownership, content match, and expiry — three asserts, zero exceptions. There's no backdoor, no support ticket that unlocks content for free. The chain is the bouncer.

---

## 🛣️ Roadmap

- [ ] Royalty splits on resale / sublicensing
- [ ] Batch licensing for catalogs
- [ ] On-chain dispute / revocation flow
- [ ] Mainnet deployment

---

## 🤝 Contributing

Issues and PRs are welcome — fork the repo, create a feature branch, and submit a pull request.

## 📜 License

This project is currently unlicensed. Add a `LICENSE` file to specify usage terms.

---

<p align="center">Built on <strong>Sui</strong> · Stored on <strong>Walrus</strong> · Gated by <strong>Seal</strong></p>
