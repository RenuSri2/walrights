import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";

// ═══════════════════════════════════════════
// CONFIG — your deployed contract
// ═══════════════════════════════════════════
const PACKAGE_ID = "0xc1b6baf4d46394954d31098eaf1c71283617ab81a084134288bb5d6c4ae738d8";
const NETWORK = "testnet";

// ═══════════════════════════════════════════
// LOAD KEYPAIR from Sui CLI keystore
// ═══════════════════════════════════════════
async function getKeypair(): Promise<Ed25519Keypair> {
  const { execSync } = await import("child_process");
  const result = execSync("sui keytool export --key-identity 0x9b18a3f658bff4d5d40a0e36c8092f3de5d8b0105577da1e65e7f4459baa132e --json 2>&1").toString();
  const lines = result.split("\n");
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed.exportedPrivateKey) {
        return Ed25519Keypair.fromSecretKey(fromBase64(parsed.exportedPrivateKey).slice(1));
      }
    } catch {}
  }
  throw new Error("Could not load keypair. Run: sui keytool list");
}

// ═══════════════════════════════════════════
// MINT MASTER RIGHTS
// ═══════════════════════════════════════════
async function mintRights() {
  const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });
  const keypair = await getKeypair();

  // Demo content — replace with real Walrus blob ID after upload
  const title = "Sunrise";
  const contentHash = "sha256_demo_hash_sunrise_track_001";
  const walrusBlobId = "demo_blob_id_replace_after_upload";
  const royaltyBps = 1000; // 10%

  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::walrights::mint_rights`,
    arguments: [
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(title))),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(contentHash))),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(walrusBlobId))),
      tx.pure.u64(royaltyBps),
      tx.object("0x6"), // Clock object (always 0x6 on Sui)
    ],
  });

  console.log("🎵 Minting master rights for:", title);
  console.log("📡 Broadcasting to testnet...");

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: {
      showEffects: true,
      showObjectChanges: true,
    },
  });

  console.log("\n✅ Master Rights Minted!");
  console.log("🧾 Tx Digest:", result.digest);

  // Extract the MasterRights object ID
  const created = result.objectChanges?.filter(
    (c) => c.type === "created" && c.objectType?.includes("MasterRights")
  );

  if (created && created.length > 0 && created[0].type === "created") {
    console.log("🎯 MasterRights ID:", created[0].objectId);
    console.log("\n👉 Save this ID — you need it for create_license.ts");
  }
}

mintRights().catch(console.error);