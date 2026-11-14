// Input checks for the form endpoint and the address check for the inbox. No I/O.

export const BODY_LIMIT = 8 * 1024 * 1024;
export const SCREENSHOT_LIMIT = 5 * 1024 * 1024;
export const PAGES = ['card', 'transfers', 'account', 'other'];

/** Only this computer may open the inbox. */
export function isLocal(address = '') {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/** PNG or JPEG by the first bytes of the file, not by its name. */
export function imageKind(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Resolves {fields, screenshot?} or {error}. */
export function readTicketInput(body, userAgent) {
  const fields = {
    name: str(body.name, 120),
    email: str(body.email, 200),
    phone: str(body.phone, 40),
    customerNumber: str(body.customerNumber, 20).toUpperCase(),
    page: str(body.page, 20),
    text: str(body.text, 2000),
    lang: str(body.lang, 10) || 'en',
    userAgent: str(userAgent, 400),
  };
  if (!fields.name) return { error: 'Full name is required' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) return { error: 'A valid email is required' };
  if (fields.customerNumber && !/^DB-\d{6}$/.test(fields.customerNumber)) return { error: 'Customer number is DB- and 6 digits' };
  if (!PAGES.includes(fields.page)) return { error: 'Choose which page' };
  if (fields.text.length < 10 || fields.text.length > 1000) return { error: 'Tell us what happened in 10 to 1000 characters' };
  let screenshot = null;
  if (body.screenshot != null) {
    const b64 = typeof body.screenshot?.dataBase64 === 'string' ? body.screenshot.dataBase64.replace(/^data:[^,]*,/, '') : '';
    const bytes = Buffer.from(b64, 'base64');
    if (!bytes.length) return { error: 'The screenshot could not be read' };
    if (bytes.length > SCREENSHOT_LIMIT) return { error: 'The screenshot is larger than 5 MB' };
    const ext = imageKind(bytes);
    if (!ext) return { error: 'The screenshot must be a PNG or JPEG' };
    screenshot = { ext, bytes };
  }
  return { fields, screenshot };
}
