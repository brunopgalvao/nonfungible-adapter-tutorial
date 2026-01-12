/**
 * Cross-Chain NFT Transfer Demo using NonFungibleAdapter
 *
 * This script demonstrates how to transfer an NFT from Parachain A to Parachain B
 * using XCM reserve transfers with the NonFungibleAdapter.
 *
 * Uses Polkadot API (PAPI) - the modern Polkadot API
 */

import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { sr25519CreateDerive } from "@polkadot-api/sr25519";
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from "@polkadot-api/sr25519";
import { ss58Encode, ss58Decode } from "@polkadot-api/ss58";
import { toHex, fromHex } from "polkadot-api/utils";

// Parachain endpoints
const PARACHAIN_A_WS = "ws://127.0.0.1:9944";
const PARACHAIN_B_WS = "ws://127.0.0.1:9945";

// Parachain IDs
const PARACHAIN_A_ID = 1000;
const PARACHAIN_B_ID = 1001;

// Pallet index for NFTs
const NFTS_PALLET_INDEX = 51;

// SS58 prefix
const SS58_PREFIX = 42;

/**
 * Create a signer from a derivation path
 */
function createSigner(derivationPath) {
    const entropy = mnemonicToEntropy(DEV_PHRASE);
    const miniSecret = entropyToMiniSecret(entropy);
    const derive = sr25519CreateDerive(miniSecret);
    const keyPair = derive(derivationPath);

    return {
        publicKey: keyPair.publicKey,
        address: ss58Encode(keyPair.publicKey, SS58_PREFIX),
        sign: (data) => keyPair.sign(data),
    };
}

/**
 * Connect to a parachain
 */
async function connectToParachain(endpoint, name) {
    console.log(`Connecting to ${name} at ${endpoint}...`);

    const provider = getWsProvider(endpoint);
    const client = createClient(provider);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(`Connected to ${name}`);
    return client;
}

/**
 * Build the XCM destination for sending to a sibling parachain
 */
function buildDestination(parachainId, recipientPublicKey) {
    return {
        type: "V4",
        value: {
            parents: 1,
            interior: {
                type: "X2",
                value: [
                    { type: "Parachain", value: parachainId },
                    {
                        type: "AccountId32",
                        value: {
                            network: undefined,
                            id: recipientPublicKey,
                        },
                    },
                ],
            },
        },
    };
}

/**
 * Build the beneficiary location (on destination chain)
 */
function buildBeneficiary(recipientPublicKey) {
    return {
        type: "V4",
        value: {
            parents: 0,
            interior: {
                type: "X1",
                value: [
                    {
                        type: "AccountId32",
                        value: {
                            network: undefined,
                            id: recipientPublicKey,
                        },
                    },
                ],
            },
        },
    };
}

/**
 * Build the NFT asset identifier for XCM
 *
 * NFT Asset format:
 * - Location: { parents: 0, interior: X2(PalletInstance(51), GeneralIndex(collectionId)) }
 * - Fungibility: NonFungible(Index(itemId))
 */
function buildNftAsset(collectionId, itemId) {
    return {
        type: "V4",
        value: [
            {
                id: {
                    parents: 0,
                    interior: {
                        type: "X2",
                        value: [
                            { type: "PalletInstance", value: NFTS_PALLET_INDEX },
                            { type: "GeneralIndex", value: BigInt(collectionId) },
                        ],
                    },
                },
                fun: {
                    type: "NonFungible",
                    value: {
                        type: "Index",
                        value: BigInt(itemId),
                    },
                },
            },
        ],
    };
}

/**
 * Transfer an NFT from this chain to a sibling parachain using reserve transfer
 */
async function transferNftToSibling(client, signer, collectionId, itemId, destParachainId, recipientPublicKey) {
    console.log(`\nInitiating NFT transfer...`);
    console.log(`  Collection: ${collectionId}`);
    console.log(`  Item: ${itemId}`);
    console.log(`  Destination: Parachain ${destParachainId}`);
    console.log(`  Recipient: ${ss58Encode(recipientPublicKey, SS58_PREFIX)}`);

    const api = client.getUnsafeApi();

    const dest = buildDestination(destParachainId, recipientPublicKey);
    const beneficiary = buildBeneficiary(recipientPublicKey);
    const assets = buildNftAsset(collectionId, itemId);

    console.log(`\nSending XCM reserve transfer...`);

    // Use limited_reserve_transfer_assets for reserve-based NFT transfer
    const tx = api.tx.PolkadotXcm.limited_reserve_transfer_assets({
        dest,
        beneficiary,
        assets,
        fee_asset_item: 0,
        weight_limit: { type: "Unlimited" },
    });

    const result = await tx.signAndSubmit(signer);

    console.log(`\nTransaction included in block: ${result.block.hash}`);

    // Log relevant XCM events
    for (const event of result.events) {
        if (event.type === "PolkadotXcm") {
            console.log(`  Event: PolkadotXcm.${event.value.type}`);
            if (event.value.type === "Sent") {
                console.log(`  XCM message sent successfully!`);
            }
        }
        if (event.type === "XcmpQueue") {
            console.log(`  Event: XcmpQueue.${event.value.type}`);
        }
    }

    return result;
}

/**
 * Query NFT owner
 */
async function queryNftOwner(client, collectionId, itemId) {
    const api = client.getUnsafeApi();

    try {
        const item = await api.query.Nfts.Item.getValue(collectionId, itemId);
        if (item) {
            return ss58Encode(item.owner, SS58_PREFIX);
        }
    } catch (e) {
        // Item doesn't exist
    }

    return null;
}

/**
 * Query collection count
 */
async function queryCollectionCount(client) {
    const api = client.getUnsafeApi();

    try {
        // Get all collections
        const collections = await api.query.Nfts.Collection.getEntries();
        return collections.length;
    } catch (e) {
        return 0;
    }
}

async function main() {
    const alice = createSigner("//Alice");
    const bob = createSigner("//Bob");

    console.log("=".repeat(60));
    console.log("Cross-Chain NFT Transfer Demo (using PAPI)");
    console.log("Using NonFungibleAdapter with Reserve Transfers");
    console.log("=".repeat(60));
    console.log(`\nAlice (sender): ${alice.address}`);
    console.log(`Bob (recipient): ${bob.address}`);

    let clientA, clientB;

    try {
        // Connect to both parachains
        clientA = await connectToParachain(PARACHAIN_A_WS, "Parachain A (Source)");
        clientB = await connectToParachain(PARACHAIN_B_WS, "Parachain B (Destination)");

        // Parameters for the transfer
        const collectionId = 0; // First collection created
        const itemId = 1; // First NFT

        console.log("\n--- Before Transfer ---");
        const ownerBefore = await queryNftOwner(clientA, collectionId, itemId);
        console.log(`NFT #${itemId} owner on Parachain A: ${ownerBefore || "Not found"}`);

        // Perform the cross-chain transfer
        console.log("\n--- Executing Cross-Chain Transfer ---");
        await transferNftToSibling(
            clientA,
            alice,
            collectionId,
            itemId,
            PARACHAIN_B_ID,
            bob.publicKey
        );

        // Wait for XCM to be processed
        console.log("\nWaiting for XCM message to be processed...");
        await new Promise((resolve) => setTimeout(resolve, 12000)); // Wait ~2 blocks

        console.log("\n--- After Transfer ---");

        // Check NFT status on source chain
        const ownerAfterA = await queryNftOwner(clientA, collectionId, itemId);
        if (ownerAfterA) {
            console.log(`NFT #${itemId} on Parachain A: Still owned by ${ownerAfterA}`);
            console.log(`  (NFT is held in reserve for the cross-chain transfer)`);
        } else {
            console.log(`NFT #${itemId} on Parachain A: Transferred/Locked`);
        }

        // Check for collections on destination chain
        console.log(`\nChecking Parachain B for received NFT...`);
        const collectionCount = await queryCollectionCount(clientB);
        console.log(`Total collections on Parachain B: ${collectionCount}`);

        console.log("\n" + "=".repeat(60));
        console.log("Transfer Complete!");
        console.log("=".repeat(60));
        console.log(`
The NFT transfer was initiated from Parachain A to Parachain B using
XCM reserve transfer. The NonFungibleAdapter handles:

1. Withdrawing the NFT from the sender on the source chain
2. Depositing/locking it in the sovereign account
3. Sending an XCM message to the destination chain
4. The destination chain processes the XCM and mints/credits the NFT

For production use, you would also need to configure:
- Foreign asset registries to track NFTs from other chains
- Collection mappings between chains
- Proper fee handling for XCM execution
        `);

    } catch (error) {
        console.error("\nError:", error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        if (clientA) clientA.destroy();
        if (clientB) clientB.destroy();
    }
}

main().catch(console.error);
