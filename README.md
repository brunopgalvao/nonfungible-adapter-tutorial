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

### Installing Dependencies

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Zombienet
npm install -g @zombienet/cli
```

### Installing Polkadot Binaries

Download pre-built binaries from the [Polkadot SDK releases](https://github.com/paritytech/polkadot-sdk/releases):

```bash
# For macOS ARM (Apple Silicon)
curl -L -o ~/.cargo/bin/polkadot \
  https://github.com/paritytech/polkadot-sdk/releases/download/polkadot-stable2512/polkadot-aarch64-apple-darwin
curl -L -o ~/.cargo/bin/polkadot-parachain \
  https://github.com/paritytech/polkadot-sdk/releases/download/polkadot-stable2512/polkadot-parachain-aarch64-apple-darwin
curl -L -o ~/.cargo/bin/polkadot-omni-node \
  https://github.com/paritytech/polkadot-sdk/releases/download/polkadot-stable2512/polkadot-omni-node-aarch64-apple-darwin

chmod +x ~/.cargo/bin/polkadot ~/.cargo/bin/polkadot-parachain ~/.cargo/bin/polkadot-omni-node

# For Linux x86_64, use the binaries without the platform suffix
# For other platforms, check the release page for available binaries
```

Verify installation:
```bash
polkadot --version
polkadot-omni-node --version
zombienet --version
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
├── chain-specs/
│   ├── parachain-a.json              # Chain spec for Para A (id: 1000)
│   ├── parachain-a-raw.json          # Raw format chain spec
│   ├── parachain-b.json              # Chain spec for Para B (id: 1001)
│   └── parachain-b-raw.json          # Raw format chain spec
├── zombienet/
│   └── network.toml                  # Zombienet config for two parachains
├── scripts/
│   ├── setup-collections.js          # Create NFT collections (PAPI)
│   └── transfer-nft.js               # Cross-chain transfer demo (PAPI)
└── README.md
```

## Quick Start

### 1. Build the Runtime

```bash
cargo build --release
```

### 2. (Optional) Regenerate Chain Specs

Chain specs are pre-built in `chain-specs/`, but you can regenerate them:

```bash
# List available presets
polkadot-omni-node chain-spec-builder list-presets \
  --runtime-wasm-path target/release/wbuild/parachain-template-runtime/parachain_template_runtime.compact.compressed.wasm

# Generate chain specs
polkadot-omni-node chain-spec-builder -c chain-specs/parachain-a.json create \
  --runtime-wasm-path target/release/wbuild/parachain-template-runtime/parachain_template_runtime.compact.compressed.wasm \
  named-preset parachain-a

polkadot-omni-node chain-spec-builder -c chain-specs/parachain-b.json create \
  --runtime-wasm-path target/release/wbuild/parachain-template-runtime/parachain_template_runtime.compact.compressed.wasm \
  named-preset parachain-b

# Add para_id and relay_chain to the chain specs (required for Zombienet)
# Edit chain-specs/parachain-a.json: add "para_id": 1000, "relay_chain": "rococo-local"
# Edit chain-specs/parachain-b.json: add "para_id": 1001, "relay_chain": "rococo-local"

# Convert to raw format
polkadot-omni-node chain-spec-builder -c chain-specs/parachain-a-raw.json convert-to-raw chain-specs/parachain-a.json
polkadot-omni-node chain-spec-builder -c chain-specs/parachain-b-raw.json convert-to-raw chain-specs/parachain-b.json
```

### 3. Spawn the Network

```bash
zombienet spawn --provider native zombienet/network.toml
```

This spawns:
- Rococo local relay chain (Alice + Bob validators)
- Parachain A (para_id: 1000) - NFT Parachain A
- Parachain B (para_id: 1001) - NFT Parachain B
- Bidirectional HRMP channels between parachains

**Note:** Zombienet assigns dynamic ports. Check the output for RPC endpoints:
```
# Look for lines like:
# collator-a: --rpc-port 52205
# collator-b: --rpc-port 52209
```

### 4. Demo with Polkadot.js Apps (Recommended)

The easiest way to test NFT operations is using the Polkadot.js Apps UI:

1. Open https://polkadot.js.org/apps/
2. Connect to your local parachain (Settings > custom endpoint)
   - Use `ws://127.0.0.1:<PORT>` where PORT is from Zombienet output
3. Navigate to Developer > Extrinsics
4. Test NFT operations:

**Create a Collection:**
- Pallet: `nfts`
- Call: `create`
- admin: Select Alice
- config: Use defaults

**Mint an NFT:**
- Pallet: `nfts`
- Call: `mint`
- collection: 0 (first collection)
- item: 1
- mintTo: Select recipient

**Cross-chain Transfer:**
- Pallet: `polkadotXcm`
- Call: `limitedReserveTransferAssets`
- dest: `{ V4: { parents: 1, interior: { X1: [{ Parachain: 1001 }] } } }`
- beneficiary: `{ V4: { parents: 0, interior: { X1: [{ AccountId32: { id: <recipient_hex> } }] } } }`
- assets: See XCM Message Structure below

### 5. (Alternative) Run Demo Scripts

```bash
cd scripts
npm install

# Set the RPC ports from Zombienet output
export PARA_A_WS="ws://127.0.0.1:<PORT_A>"
export PARA_B_WS="ws://127.0.0.1:<PORT_B>"

npm run setup   # Create NFT collections
npm run transfer # Demo cross-chain transfer
```

**Note:** The PAPI scripts may experience memory issues when parsing large chain metadata. For reliable testing, use Polkadot.js Apps instead.

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

## Cross-Chain NFT Transfer Flow

### Reserve Transfer (Recommended)

1. **Source Chain (A):** NFT is locked/reserved in the sovereign account
2. **XCM Message:** Sent via HRMP to destination chain
3. **Destination Chain (B):** Mints derivative NFT to recipient

```
Parachain A                    Parachain B
    |                              |
    | 1. Lock NFT                  |
    |    (to sovereign account)   |
    |                              |
    |---- 2. XCM Reserve Transfer ---->|
    |                              |
    |                    3. Mint derivative
    |                       to recipient
```

### XCM Message Structure

For Polkadot.js Apps, construct the assets parameter as:

```json
{
  "V4": [
    {
      "id": {
        "parents": 0,
        "interior": {
          "X2": [
            { "PalletInstance": 51 },
            { "GeneralIndex": 0 }
          ]
        }
      },
      "fun": {
        "NonFungible": {
          "Index": 1
        }
      }
    }
  ]
}
```

For PAPI (JavaScript):

```javascript
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
which polkadot-parachain

# Use native provider on macOS
zombienet spawn --provider native zombienet/network.toml

# Increase timeout if needed (edit zombienet/network.toml)
# timeout = 2000
```

### Binary Architecture Mismatch (macOS)

If you see "cannot execute binary file", ensure you downloaded the correct binary:
- Apple Silicon (M1/M2/M3): Use `aarch64-apple-darwin` binaries
- Intel Mac: Use `x86_64-apple-darwin` binaries

### PAPI Script Memory Issues

The demo scripts use `getUnsafeApi()` which dynamically generates types from metadata. This can cause memory issues with large runtimes. Solutions:

1. **Use Polkadot.js Apps** - Recommended for testing
2. **Generate typed descriptors** - Run `papi codegen` against your chain
3. **Increase Node memory** - `NODE_OPTIONS="--max-old-space-size=8192" npm run setup`

### XCM Transfer Fails

1. Verify HRMP channels are open between parachains
2. Check that both chains have sufficient balance for fees
3. Verify the asset location format matches the NftsMatcher
4. Check XCM events on both chains for error details

## Resources

- [Polkadot SDK Documentation](https://paritytech.github.io/polkadot-sdk/master/polkadot_sdk_docs/index.html)
- [pallet-nfts](https://github.com/paritytech/polkadot-sdk/tree/master/substrate/frame/nfts)
- [XCM Configuration](https://docs.polkadot.com/develop/interoperability/xcm-config/)
- [NonFungiblesAdapter Source](https://github.com/paritytech/polkadot-sdk/blob/master/polkadot/xcm/xcm-builder/src/nonfungibles_adapter.rs)
- [Polkadot API (PAPI)](https://papi.how/) - Modern TypeScript API for Polkadot
- [Zombienet Documentation](https://paritytech.github.io/zombienet/)

## License

MIT-0
