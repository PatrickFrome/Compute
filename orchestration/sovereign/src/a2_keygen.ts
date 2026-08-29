import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
process.stdout.write(Buffer.from(pem, "utf8").toString("base64"));
