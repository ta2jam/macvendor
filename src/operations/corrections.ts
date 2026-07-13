import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { validateContactEmail } from "@/lib/public-config";

const CATEGORIES = ["incorrect_assignment", "incorrect_context", "privacy", "rights", "withdrawal"] as const;
const STATUSES = ["received", "triaged", "accepted", "rejected", "closed"] as const;
const REQUEST_FIELDS = new Set(["category", "target", "requestedChange", "evidenceUrl", "contactEmail"]);
export type CorrectionCategory = typeof CATEGORIES[number];
export type CorrectionStatus = typeof STATUSES[number];
export class CorrectionValidationError extends Error {}

interface EncryptedContactV1 { v: 1; algorithm: "A256GCM"; iv: string; tag: string; ciphertext: string }
interface EncryptedContactV2 { v: 2; algorithm: "A256GCM"; keyId:string; iv: string; tag: string; ciphertext: string }
type EncryptedContact=EncryptedContactV1|EncryptedContactV2;

function invalid(message: string): never { throw new CorrectionValidationError(message); }

function encryptionKey(): Buffer {
  const raw = process.env.CORRECTION_ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== 32) throw new Error("CORRECTION_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

function encryptionKeyId():string{
  const value=process.env.CORRECTION_ENCRYPTION_KEY_ID??"primary";
  if(!/^[A-Za-z0-9._-]{1,40}$/.test(value))throw new Error("CORRECTION_ENCRYPTION_KEY_ID is invalid");
  return value;
}

function decryptionKey(value:EncryptedContact):Buffer{
  if(value.v===1||value.keyId===encryptionKeyId())return encryptionKey();
  let ring:unknown;
  try{ring=JSON.parse(process.env.CORRECTION_DECRYPTION_KEYS??"{}");}catch{throw new Error("CORRECTION_DECRYPTION_KEYS must be valid JSON");}
  if(!ring||typeof ring!=="object"||Array.isArray(ring))throw new Error("CORRECTION_DECRYPTION_KEYS must be a JSON object");
  const encoded=(ring as Record<string,unknown>)[value.keyId];
  const key=typeof encoded==="string"?Buffer.from(encoded,"base64"):Buffer.alloc(0);
  if(key.length!==32)throw new Error(`correction decryption key is unavailable: ${value.keyId}`);
  return key;
}

export function encryptCorrectionContact(email: string): EncryptedContactV2 {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(email, "utf8"), cipher.final()]);
  return { v: 2, algorithm: "A256GCM", keyId:encryptionKeyId(),iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64") };
}

export function decryptCorrectionContact(value: EncryptedContact): string {
  if (!value||![1,2].includes(value.v)||value.algorithm !== "A256GCM") throw new Error("unsupported correction contact ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", decryptionKey(value), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function text(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") invalid(`${field} must be a string`);
  const cleaned = value.normalize("NFC").replace(/[\u0000-\u001F\u007F]/gu, " ").replace(/\s+/gu, " ").trim();
  if (cleaned.length < minimum || cleaned.length > maximum) invalid(`${field} must contain ${minimum}-${maximum} characters`);
  return cleaned;
}

function evidenceUrl(value: unknown): string {
  const input = text(value, "evidenceUrl", 9, 2048);
  let url: URL;
  try { url = new URL(input); } catch { invalid("evidenceUrl must be a valid HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password) invalid("evidenceUrl must be a valid HTTPS URL");
  return url.toString();
}

export async function createCorrectionRequest(pool: Pool, input: Record<string, unknown>) {
  if (Object.keys(input).some((field) => !REQUEST_FIELDS.has(field))) invalid("request contains an unsupported field");
  if (!CATEGORIES.includes(input.category as CorrectionCategory)) invalid("category is invalid");
  let contactEmail: string;
  try { contactEmail = validateContactEmail(input.contactEmail); } catch { invalid("contactEmail must be a valid email address"); }
  const reference = `CORR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const values = { category: input.category as CorrectionCategory, target: text(input.target, "target", 1, 128),
    requestedChange: text(input.requestedChange, "requestedChange", 20, 2000), evidenceUrl: evidenceUrl(input.evidenceUrl),
    contact: encryptCorrectionContact(contactEmail) };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO correction_requests (reference, category, target, requested_change, evidence_url, contact_ciphertext)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [reference, values.category, values.target, values.requestedChange, values.evidenceUrl, JSON.stringify(values.contact)],
    );
    await client.query(
      `INSERT INTO correction_events (correction_request_id, event_type, actor_id, metadata)
       VALUES ($1, 'received', 'public:intake', '{}')`, [inserted.rows[0]!.id],
    );
    await client.query("COMMIT");
    return { reference, status: "received" as const, receivedAt: inserted.rows[0]!.created_at.toISOString() };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function listCorrectionRequests(pool: Pool, status?: CorrectionStatus) {
  if (status && !STATUSES.includes(status)) invalid("status is invalid");
  const result = await pool.query(
    `SELECT reference, category, target, status, created_at, updated_at, retention_until
     FROM correction_requests WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at LIMIT 200`, [status ?? null],
  );
  return result.rows;
}

export async function showCorrectionRequest(pool: Pool, reference: string, actorId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string; contact_ciphertext: EncryptedContact }>(
      "SELECT id, contact_ciphertext FROM correction_requests WHERE reference=$1 FOR UPDATE", [reference],
    );
    if (!result.rows[0]) throw new Error("correction request not found");
    const contactEmail = decryptCorrectionContact(result.rows[0].contact_ciphertext);
    await client.query(`INSERT INTO correction_events (correction_request_id,event_type,actor_id,metadata)
      VALUES ($1,'contact_accessed',$2,'{}')`, [result.rows[0].id, actorId]);
    await client.query("COMMIT");
    return { reference, contactEmail };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function updateCorrectionStatus(pool: Pool, reference: string, status: CorrectionStatus, actorId: string, note: string) {
  if (!STATUSES.includes(status) || status === "received") invalid("status is invalid");
  const safeNote = text(note, "note", 10, 500);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query<{ id: string; status: CorrectionStatus }>(
      `UPDATE correction_requests SET status=$2, updated_at=now() WHERE reference=$1 AND status <> 'closed'
       RETURNING id,status`, [reference, status],
    );
    if (!updated.rows[0]) throw new Error("correction request not found or already closed");
    await client.query(`INSERT INTO correction_events (correction_request_id,event_type,actor_id,metadata)
      VALUES ($1,'status_changed',$2,$3)`, [updated.rows[0].id, actorId, JSON.stringify({ status, note: safeNote })]);
    await client.query("COMMIT");
    return { reference, status };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function purgeExpiredCorrectionContacts(pool: Pool, actorId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const purged = await client.query<{ id: string }>(
      `UPDATE correction_requests SET contact_ciphertext='{"purged":true}'::jsonb,
         contact_purged_at=now(), updated_at=now()
       WHERE retention_until <= now() AND contact_purged_at IS NULL RETURNING id`,
    );
    for (const row of purged.rows) await client.query(
      `INSERT INTO correction_events (correction_request_id,event_type,actor_id,metadata)
       VALUES ($1,'retention_deleted',$2,'{}')`, [row.id, actorId],
    );
    await client.query("COMMIT");
    return { purged: purged.rowCount ?? 0 };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
