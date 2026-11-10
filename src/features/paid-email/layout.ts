/**
 * Satu tata letak untuk semua email aplikasi. HTML email memakai tabel dan gaya inline karena hanya itu yang tampil sama di
 * Gmail, Outlook, dan aplikasi email HP. Semua teks dinamis di-escape; nilai boleh berisi baris baru.
 */
export type EmailRow = [label: string, value: string];
export type EmailContent = {
  preheader: string;
  eyebrow: string;
  title: string;
  paragraphs: string[];
  highlight?: { heading: string; rows: EmailRow[] };
  rows: EmailRow[];
  total?: EmailRow;
  button?: { label: string; url: string } | null;
  notes: string[];
  footer: string;
  logoUrl: string | null;
};

const COLOR = { page: "#f0f3ed", surface: "#ffffff", ink: "#24392f", muted: "#59665d", line: "#dce2d9", brand: "#285b43", soft: "#e6eee5", warmBg: "#fcf1e3", warmInk: "#654526" };
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

// Teks dari pemilik atau pembeli bisa berisi baris baru. Subjek dan sapaan tidak boleh berisi pemisah header.
export function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

const multiline = (value: string) => escapeHtml(value).replace(/\r?\n/g, "<br>");

function rowsHtml(rows: EmailRow[], total?: EmailRow): string {
  const body = rows.map(([label, value]) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid ${COLOR.line};color:${COLOR.muted};font-size:14px;vertical-align:top;width:42%">${escapeHtml(label)}</td>
<td style="padding:10px 0;border-bottom:1px solid ${COLOR.line};color:${COLOR.ink};font-size:14px;font-weight:600;text-align:right;vertical-align:top">${multiline(value)}</td></tr>`).join("");
  const totalRow = total ? `<tr>
<td style="padding:14px 0 0;color:${COLOR.ink};font-size:15px;font-weight:700">${escapeHtml(total[0])}</td>
<td style="padding:14px 0 0;color:${COLOR.brand};font-size:20px;font-weight:800;text-align:right">${escapeHtml(total[1])}</td></tr>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 4px">${body}${totalRow}</table>`;
}

export function renderEmailHtml(content: EmailContent): string {
  const header = content.logoUrl
    ? `<img src="${escapeHtml(content.logoUrl)}" alt="juarasatu" height="56" style="display:block;height:56px;width:auto;border:0">`
    : `<span style="font-family:${FONT};font-size:22px;font-weight:800;color:${COLOR.brand};letter-spacing:-0.3px">juarasatu</span>`;
  const highlight = content.highlight ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;background:${COLOR.soft};border-radius:12px">
<tr><td style="padding:16px 18px">
<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:${COLOR.brand};text-transform:uppercase;letter-spacing:0.6px">${escapeHtml(content.highlight.heading)}</p>
${content.highlight.rows.map(([label, value]) => `<p style="margin:6px 0 0;font-size:14px;color:${COLOR.ink}"><span style="color:${COLOR.muted}">${escapeHtml(label)}</span><br><strong>${multiline(value)}</strong></p>`).join("")}
</td></tr></table>` : "";
  const button = content.button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr>
<td style="background:${COLOR.brand};border-radius:10px"><a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none">${escapeHtml(content.button.label)}</a></td>
</tr></table>` : "";
  const notes = content.notes.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:${COLOR.warmBg};border-radius:10px">
<tr><td style="padding:12px 16px">${content.notes.map((note) => `<p style="margin:4px 0;font-size:13px;line-height:1.5;color:${COLOR.warmInk}">${escapeHtml(note)}</p>`).join("")}</td></tr></table>` : "";
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(oneLine(content.title))}</title></head>
<body style="margin:0;padding:0;background:${COLOR.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.page}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT}">
<tr><td style="padding:0 4px 16px">${header}</td></tr>
<tr><td style="background:${COLOR.surface};border:1px solid ${COLOR.line};border-radius:16px;overflow:hidden">
<div style="height:6px;background:${COLOR.brand};line-height:6px;font-size:0">&nbsp;</div>
<div style="padding:28px 28px 30px">
<span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${COLOR.soft};color:${COLOR.brand};font-size:12px;font-weight:700;letter-spacing:0.4px">${escapeHtml(content.eyebrow)}</span>
<h1 style="margin:14px 0 10px;font-size:23px;line-height:1.3;color:${COLOR.ink};font-weight:800">${escapeHtml(oneLine(content.title))}</h1>
${content.paragraphs.map((paragraph) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${COLOR.ink}">${multiline(paragraph)}</p>`).join("")}
${highlight}
${rowsHtml(content.rows, content.total)}
${button}
${notes}
</div></td></tr>
<tr><td style="padding:18px 8px 0;text-align:center;font-size:12px;line-height:1.6;color:${COLOR.muted}">${escapeHtml(content.footer)}</td></tr>
</table></td></tr></table>
</body></html>`;
}

export function renderEmailText(content: EmailContent): string {
  const lines = [oneLine(content.title), "", ...content.paragraphs, ""];
  if (content.highlight) lines.push(content.highlight.heading.toUpperCase(), ...content.highlight.rows.map(([label, value]) => `${label}: ${value}`), "");
  lines.push(...content.rows.map(([label, value]) => `${label}: ${value}`));
  if (content.total) lines.push(`${content.total[0]}: ${content.total[1]}`);
  if (content.button) lines.push("", `${content.button.label}: ${content.button.url}`);
  if (content.notes.length) lines.push("", ...content.notes);
  lines.push("", content.footer);
  return lines.join("\n");
}
