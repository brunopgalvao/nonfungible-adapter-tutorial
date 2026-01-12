# NonFungible Adapter Tutorial

A comprehensive tutorial demonstrating how to configure cross-chain NFT transfers using the Polkadot SDK's `NonFungibleAdapter` and `pallet-nfts`.

## Overview

This repository provides a working example of:
- Configuring `pallet-nfts` in a parachain runtime
- Setting up XCM configuration for NFT transfers
- Understanding the `NonFungibleAdapter` pattern
- Running two parachains locally with Zombienet

## Prerequisites

- Rust toolchain (stable)
- Node.js 18+
- [Zombienet](https://github.com/paritytech/zombienet)
- `polkadot` and `polkadot-omni-node` binaries

### Install Dependencies

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Zombienet
npm install -g @zombienet/cli
```

## Project Structure

```
nonfungible-adapter-tutorial/
├── runtime/
│   └── src/
│       ├── lib.rs                    # Runtime with pallet-nfts (index 51)
│       ├── genesis_config_presets.rs # Presets for parachain-a and parachain-b
│       └── configs/
│           ├── mod.rs                # pallet-nfts configuration
│           └── xcm_config.rs         # XCM + NftsMatcher configuration
├── zombienet/
│   └── network.toml                  # Zombienet config for two parachains
├── scripts/
│   ├── setup-collections.js          # Create NFT collections
│   └── transfer-nft.js               # Cross-chain transfer demo
└── README.md
```

## Quick Start

### 1. Build the Runtime

```bash
cargo build --release
```

### 2. Spawn the Network

```bash
zombienet spawn zombienet/network.toml
```

This spawns:
- Rococo local relay chain (Alice + Bob validators)
- Parachain A (para_id: 1000) with Alice as collator
- Parachain B (para_id: 1001) with Bob as collator
- Bidirectional HRMP channels between parachains

### 3. Run Demo Scripts

```bash
cd scripts
npm install
npm run setup   # Create NFT collections
npm run transfer # Demo cross-chain transfer
```

## Key Concepts

### pallet-nfts Configuration

The runtime includes `pallet-nfts` at pallet index 51:

```rust
impl pallet_nfts::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type CollectionId = u32;
    type ItemId = u32;
    type Currency = Balances;
    type ForceOrigin = EnsureRoot<AccountId>;
    type CreateOrigin = AsEnsureOriginWithArg<EnsureSigned<AccountId>>;
    type BlockNumberProvider = System;
    // ... other config
}
```

### NFT Asset Representation in XCM

NFTs are represented in XCM using:

```
Asset {
    id: Location {
        parents: 0,
        interior: X2(PalletInstance(51), GeneralIndex(collection_id))
    },
    fun: NonFungible(Index(item_id))
}
```

### NftsMatcher

The `NftsMatcher` identifies NFT assets for the XCM executor:

```rust
pub struct NftsMatcher;
impl MatchesNonFungibles<u32, u32> for NftsMatcher {
    fn matches_nonfungibles(a: &Asset) -> Result<(u32, u32), Error> {
        match (&a.id.0.unpack(), &a.fun) {
            (
                (0, [PalletInstance(51), GeneralIndex(collection)]),
                Fungibility::NonFungible(AssetInstance::Index(item)),
            ) => Ok((*collection as u32, *item as u32)),
            _ => Err(Error::AssetNotHandled),
        }
    }
}
```

### NonFungibleAdapter Pattern

The `NonFungibleAdapter` from `xcm-builder` handles NFT asset transactions:

```rust
pub type NftsTransactor = NonFungiblesAdapter<
    Nfts,               // The NFT pallet
    NftsMatcher,        // Asset matcher
    LocationToAccountId, // Location converter
    AccountId,
    NoChecking,         // Teleport checking
    (),
>;
```

**Important Note:** The current `NonFungiblesAdapter` requires pallets to implement the `nonfungibles::Mutate` and `nonfungibles::Transfer` traits. However, `pallet-nfts` implements the newer `nonfungibles_v2` traits. For production use, you need to:

1. Create a wrapper implementing the old traits using pallet-nfts
2. Use a custom `TransactAsset` implementation
3. Wait for xcm-builder to support nonfungibles_v2

### Reserve Asset Configuration

To accept NFTs from sibling parachains as reserves:

```rust
pub struct NftsFromSiblings;
impl ContainsPair<Asset, Location> for NftsFromSiblings {
    fn contains(asset: &Asset, origin: &Location) -> bool {
        matches!(
            (origin.unpack(), &asset.fun),
            ((1, [Parachain(_)]), Fungibility::NonFungible(_))
        )
    }
}

pub type IsReserveAsset = (NativeAsset, NftsFromSiblings);
```

## Genesis Config Presets

Two presets are available for the two parachains:

| Preset | Para ID | Collator | Sudo |
|--------|---------|----------|------|
| `parachain-a` | 1000 | Alice | Alice |
| `parachain-b` | 1001 | Bob | Bob |

Generate chain specs:

```bash
# Parachain A
polkadot-omni-node build-spec --chain ./target/release/wbuild/parachain-template-runtime/parachain_template_runtime.wasm \
    --genesis-preset parachain-a > chain-spec-a.json

# Parachain B
polkadot-omni-node build-spec --chain ./target/release/wbuild/parachain-template-runtime/parachain_template_runtime.wasm \
    --genesis-preset parachain-b > chain-spec-b.json
```

## Cross-Chain NFT Transfer Flow

### Reserve Transfer (Recommended)

1. **Source Chain (A):** NFT is locked/reserved in the sovereign account
2. **XCM Message:** Sent via HRMP to destination chain
3. **Destination Chain (B):** Mints derivative NFT to recipient

```
Parachain A                    Parachain B
    │                              │
    │ 1. Lock NFT                  │
    │    (to sovereign account)   │
    │                              │
    │──── 2. XCM Reserve Transfer ─────│
    │                              │
    │                    3. Mint derivative
    │                       to recipient
```

### XCM Message Structure (using PAPI)

```javascript
import { createClient } from "polkadot-api";

// Build NFT asset for XCM
const assets = {
    type: "V4",
    value: [{
        id: {
            parents: 0,
            interior: {
                type: "X2",
                value: [
                    { type: "PalletInstance", value: 51 },
                    { type: "GeneralIndex", value: BigInt(collectionId) },
                ],
            },
        },
        fun: {
            type: "NonFungible",
            value: { type: "Index", value: BigInt(itemId) },
        },
    }],
};

// Reserve transfer
const tx = api.tx.PolkadotXcm.limited_reserve_transfer_assets({
    dest,        // V4 Location to sibling parachain
    beneficiary, // V4 Location for recipient account
    assets,      // NFT asset representation
    fee_asset_item: 0,
    weight_limit: { type: "Unlimited" },
});
```

## Extending This Tutorial

### Adding Full NFT XCM Support

To enable actual NFT transfers, implement a trait bridge:

```rust
use frame_support::traits::tokens::nonfungibles;

/// Wrapper to bridge nonfungibles_v2 to nonfungibles traits
pub struct NftsBridge<T>(PhantomData<T>);

impl<T: pallet_nfts::Config> nonfungibles::Transfer<T::AccountId> for NftsBridge<T> {
    fn transfer(
        collection: &Self::CollectionId,
        item: &Self::ItemId,
        destination: &T::AccountId,
    ) -> DispatchResult {
        pallet_nfts::Pallet::<T>::do_transfer(
            *collection,
            *item,
            destination.clone(),
            |_, _| Ok(())
        )
    }
}
```

### Foreign Asset Registry

For production, implement a foreign asset registry to track NFTs from other chains:

```rust
// Map foreign locations to local collection IDs
type ForeignNfts = StorageMap<_, Blake2_128Concat, Location, CollectionId>;
```

## Troubleshooting

### Build Errors

```bash
# Clean and rebuild
cargo clean
cargo build --release
```

### Zombienet Issues

```bash
# Check binaries are in PATH
which polkadot
which polkadot-omni-node

# Increase timeout if needed
# Edit zombienet/network.toml: timeout = 2000
```

### XCM Transfer Fails

1. Verify HRMP channels are open between parachains
2. Check that both chains have sufficient balance for fees
3. Verify the asset location format matches the NftsMatcher

## Resources

- [Polkadot SDK Documentation](https://paritytech.github.io/polkadot-sdk/master/polkadot_sdk_docs/index.html)
- [pallet-nfts](https://github.com/paritytech/polkadot-sdk/tree/master/substrate/frame/nfts)
- [XCM Configuration](https://docs.polkadot.com/develop/interoperability/xcm-config/)
- [NonFungiblesAdapter Source](https://github.com/paritytech/polkadot-sdk/blob/master/polkadot/xcm/xcm-builder/src/nonfungibles_adapter.rs)
- [Polkadot API (PAPI)](https://papi.how/) - Modern TypeScript API for Polkadot

## License

MIT-0
