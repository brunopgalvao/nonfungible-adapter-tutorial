/**
 * Setup NFT Collections on both Parachains
 *
 * This script creates NFT collections on Parachain A and Parachain B,
 * and mints sample NFTs for testing cross-chain transfers.
 *
 * Uses Polkadot API (PAPI) - the modern Polkadot API
 */

import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { sr25519CreateDerive, withNetworkAccount } from "@polkadot-labs/hdkd";
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from "@polkadot-labs/hdkd-helpers";
import { getPolkadotSigner } from "polkadot-api/signer";

// Parachain endpoints (adjust ports based on your Zombienet config)
// Default ports - update these after running Zombienet
const PARACHAIN_A_WS = process.env.PARA_A_WS || "ws://127.0.0.1:52205";
const PARACHAIN_B_WS = process.env.PARA_B_WS || "ws://127.0.0.1:52209";

// SS58 prefix for the parachain (42 is generic substrate)
const SS58_PREFIX = 42;

/**
 * Convert a public key to SS58 address
 */
function toSs58Address(publicKey) {
    // Create a dummy keypair just for the address conversion
    const dummyKeyPair = {
        publicKey: publicKey instanceof Uint8Array ? publicKey : new Uint8Array(publicKey),
        sign: () => new Uint8Array(64),
    };
    const account = withNetworkAccount(dummyKeyPair, SS58_PREFIX);
    return account.ss58Address;
}

/**
 * Create a signer from a derivation path (e.g., "//Alice")
 */
function createSigner(derivationPath) {
    const entropy = mnemonicToEntropy(DEV_PHRASE);
    const miniSecret = entropyToMiniSecret(entropy);
    const derive = sr25519CreateDerive(miniSecret);
    const keyPair = derive(derivationPath);
    const account = withNetworkAccount(keyPair, SS58_PREFIX);

    // Create a PAPI-compatible signer
    const signer = getPolkadotSigner(
        account.publicKey,
        "Sr25519",
        (input) => keyPair.sign(input)
    );

    return {
        publicKey: account.publicKey,
        address: account.ss58Address,
        signer,
    };
}

/**
 * Connect to a parachain and get the typed API
 */
async function connectToParachain(endpoint, name) {
    console.log(`Connecting to ${name} at ${endpoint}...`);

    const provider = getWsProvider(endpoint);
    const client = createClient(provider);

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(`Connected to ${name}`);
    return client;
}

/**
 * Create an NFT collection
 */
async function createCollection(client, signer, admin) {
    console.log(`Creating NFT collection...`);

    const api = client.getUnsafeApi();

    // Create collection with admin as the owner
    const tx = api.tx.Nfts.create({
        admin: { type: "Id", value: admin },
        config: {
            settings: 0n, // All settings disabled by default
            max_supply: undefined,
            mint_settings: {
                mint_type: { type: "Issuer" },
                price: undefined,
                start_block: undefined,
                end_block: undefined,
                default_item_settings: 0n,
            },
        },
    });

    // Sign and submit
    const result = await tx.signAndSubmit(signer.signer);

    console.log(`Transaction included in block: ${result.block.hash}`);

    // Find the Created event to get the collection ID
    for (const event of result.events) {
        if (event.type === "Nfts" && event.value.type === "Created") {
            const collectionId = event.value.value.collection;
            console.log(`Collection created with ID: ${collectionId}`);
            return collectionId;
        }
    }

    return null;
}

/**
 * Mint an NFT
 */
async function mintNft(client, signer, collectionId, itemId, mintTo) {
    console.log(`Minting NFT #${itemId} in collection #${collectionId}...`);

    const api = client.getUnsafeApi();

    const tx = api.tx.Nfts.mint({
        collection: collectionId,
        item: itemId,
        mint_to: { type: "Id", value: mintTo },
        witness_data: null,
    });

    const result = await tx.signAndSubmit(signer.signer);

    console.log(`NFT minted! Block: ${result.block.hash}`);

    // Check for Issued event
    for (const event of result.events) {
        if (event.type === "Nfts" && event.value.type === "Issued") {
            console.log(`NFT #${itemId} issued successfully`);
            return true;
        }
    }

    return false;
}

/**
 * Set metadata for an NFT
 */
async function setMetadata(client, signer, collectionId, itemId, metadata) {
    console.log(`Setting metadata for NFT #${itemId}...`);

    const api = client.getUnsafeApi();

    const tx = api.tx.Nfts.set_metadata({
        collection: collectionId,
        item: itemId,
        data: metadata,
    });

    const result = await tx.signAndSubmit(signer.signer);
    console.log(`Metadata set! Block: ${result.block.hash}`);

    return true;
}

/**
 * Query NFT owner
 */
async function queryNftOwner(client, collectionId, itemId) {
    const api = client.getUnsafeApi();

    try {
        const item = await api.query.Nfts.Item.getValue(collectionId, itemId);
        if (item) {
            return toSs58Address(item.owner);
        }
    } catch (e) {
        // Item doesn't exist
    }

    return null;
}

async function main() {
    // Create signers for Alice and Bob
    const alice = createSigner("//Alice");
    const bob = createSigner("//Bob");

    console.log("=".repeat(60));
    console.log("NFT Collection Setup Script (using PAPI)");
    console.log("=".repeat(60));
    console.log(`Alice address: ${alice.address}`);
    console.log(`Bob address: ${bob.address}`);
    console.log("");

    let clientA, clientB;

    try {
        // Connect to both parachains
        clientA = await connectToParachain(PARACHAIN_A_WS, "Parachain A");
        clientB = await connectToParachain(PARACHAIN_B_WS, "Parachain B");

        console.log("\n--- Setting up Parachain A ---");

        // Create collection on Parachain A
        const collectionIdA = await createCollection(clientA, alice, alice.address);

        if (collectionIdA !== null) {
            // Mint NFTs on Parachain A
            await mintNft(clientA, alice, collectionIdA, 1, alice.address);
            await mintNft(clientA, alice, collectionIdA, 2, alice.address);
            await mintNft(clientA, alice, collectionIdA, 3, bob.address);

            // Set metadata
            await setMetadata(clientA, alice, collectionIdA, 1, "NFT #1 - Ready for XCM transfer");
            await setMetadata(clientA, alice, collectionIdA, 2, "NFT #2 - Cross-chain demo");
        }

        console.log("\n--- Setting up Parachain B ---");

        // Create collection on Parachain B (for receiving foreign NFTs)
        const collectionIdB = await createCollection(clientB, bob, bob.address);

        if (collectionIdB !== null) {
            // Mint a local NFT on Parachain B
            await mintNft(clientB, bob, collectionIdB, 1, bob.address);
            await setMetadata(clientB, bob, collectionIdB, 1, "Local NFT on Parachain B");
        }

        console.log("\n--- Summary ---");
        console.log(`Parachain A Collection ID: ${collectionIdA}`);
        if (collectionIdA !== null) {
            console.log(`  - NFT #1 owner: ${await queryNftOwner(clientA, collectionIdA, 1)}`);
            console.log(`  - NFT #2 owner: ${await queryNftOwner(clientA, collectionIdA, 2)}`);
            console.log(`  - NFT #3 owner: ${await queryNftOwner(clientA, collectionIdA, 3)}`);
        }
        console.log(`Parachain B Collection ID: ${collectionIdB}`);
        if (collectionIdB !== null) {
            console.log(`  - NFT #1 owner: ${await queryNftOwner(clientB, collectionIdB, 1)}`);
        }

        console.log("\n" + "=".repeat(60));
        console.log("Setup complete! You can now run the transfer script.");
        console.log("=".repeat(60));

    } catch (error) {
        console.error("Error:", error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        if (clientA) clientA.destroy();
        if (clientB) clientB.destroy();
    }
}

main().catch(console.error);
