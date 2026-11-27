// Makes the SYNTHETIC rewarded-ad callback of scripts/test-verifiers.mjs:   node scripts/fixtures/verifiers/make-ssv.mjs
// A callback in AdMob's own format (same parameters, same order, signature and key_id last; ECDSA P-256 / SHA-256, DER,
// base64url), signed with a key pair made here. The public key joins ssv-keys.json under SYNTHETIC_KEY_ID, beside Google's real
// key; the private key is thrown away, so nothing can ever be signed with it again and the fixture stays as recorded.
// It stands in for a callback captured from AdMob until one is put in ssv-callback.real.txt (README.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, createSign } from "node:crypto";

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const SYNTHETIC_KEY_ID = 990000001;
// what the test expects to find in it (scripts/test-verifiers.mjs SSV)
const params = [
  ["ad_network", "5450213213286189855"], ["ad_unit", "2747237135"], ["custom_data", "Zml4dHVyZS10aWNrZXQtMDAx"], ["reward_amount", "1"], ["reward_item", "Reward"],
  ["timestamp", "1795953600000"], ["transaction_id", "0006a1f2c3b4d5e6f708192a3b4c5d6e"], ["user_id", "google:8800001"],
];

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const signed = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const signature = createSign("SHA256").update(signed).sign(privateKey).toString("base64url"); // DER, as AdMob sends it
fs.writeFileSync(path.join(DIR, "ssv-callback.synthetic.txt"), `https://www.shadoku.net/api/app/ads/ssv?${signed}&signature=${signature}&key_id=${SYNTHETIC_KEY_ID}\n`);

const file = path.join(DIR, "ssv-keys.json");
const list = JSON.parse(fs.readFileSync(file, "utf8"));
list.keys = list.keys.filter((k) => k.keyId !== SYNTHETIC_KEY_ID);
list.keys.push({ keyId: SYNTHETIC_KEY_ID, pem: publicKey.export({ type: "spki", format: "pem" }).trim(), base64: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
console.log("wrote ssv-callback.synthetic.txt and the synthetic key in ssv-keys.json");
