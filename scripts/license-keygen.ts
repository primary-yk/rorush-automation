import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

console.log("Add to your app .env (public — safe in shipped builds):\n");
console.log(`LICENSE_PUBLIC_KEY=${JSON.stringify(pub.trim())}\n`);
console.log("Keep PRIVATE only on your machine (issue licenses with LICENSE_PRIVATE_KEY):\n");
console.log(`LICENSE_PRIVATE_KEY=${JSON.stringify(priv.trim())}\n`);
