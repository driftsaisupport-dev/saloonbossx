import type { CertificateTemplate } from '../database/Database';
import { formatDate } from './helpers';

export function escapeHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Small deterministic code so a certificate can be checked against the app later.
export function verifyCode(student: any): string {
  const raw = `${student?.id || 0}|${(student?.name || '').trim().toLowerCase()}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  return `SBX-${String(student?.id || 0).padStart(4, '0')}-${h.toString(16).toUpperCase().padStart(8, '0')}`;
}

function fillTokens(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => escapeHtml(vars[k] ?? ''));
}

interface RenderArgs {
  student: any;
  course: any;
  batch: any;
  profile: any;
  template: CertificateTemplate;
  photoDataUri?: string;
  sig1DataUri?: string;
  sig2DataUri?: string;
  sealDataUri?: string;
}

export function renderCertificateHTML(a: RenderArgs): string {
  const t = a.template;
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(t.accent) ? t.accent : '#A84F18';
  const dates = a.batch ? `${escapeHtml(a.batch.start_date)} to ${escapeHtml(a.batch.end_date)}` : '';
  const vars = {
    student: a.student?.name || '',
    course: a.course?.name || 'Beauty & Grooming',
    dates,
    batch: a.batch?.batch_name || '',
    salon: a.profile?.name || 'SaloonBossX Academy',
    date: formatDate(new Date()),
  };

  const body = fillTokens(t.body || '', vars);
  const title = escapeHtml(t.title || 'Certificate of Completion');
  const salon = escapeHtml(a.profile?.name || 'SaloonBossX Academy');
  const name = escapeHtml(a.student?.name || '');
  const code = t.show_verify_code ? verifyCode(a.student) : '';

  const sig1Name = escapeHtml(t.signatory1_name || a.profile?.owner_name || 'Director');
  const sig1Title = escapeHtml(t.signatory1_title || '');
  const sig2Name = escapeHtml(t.signatory2_name || '');
  const sig2Title = escapeHtml(t.signatory2_title || '');

  const sigBlock = (img: string | undefined, nm: string, ti: string) => `
    <div class="sig">
      ${img ? `<img class="sigimg" src="${img}" />` : '<div class="sigline"></div>'}
      <div class="signm">${nm}</div>
      ${ti ? `<div class="sigti">${ti}</div>` : ''}
    </div>`;

  const seal = a.sealDataUri
    ? `<img class="seal-img" src="${a.sealDataUri}" />`
    : `<div class="seal">${salon.slice(0, 18).toUpperCase()}<br/>· SEAL ·</div>`;

  const photo = (t.show_photo && a.photoDataUri) ? `<img class="photo" src="${a.photoDataUri}" />` : '';

  const layoutCSS: Record<string, string> = {
    classic: `
      body{font-family:'Georgia','Times New Roman',serif;background:#fff;margin:0}
      .cert{width:900px;height:636px;margin:0 auto;box-sizing:border-box;border:12px solid ${accent};padding:26px;position:relative;text-align:center}
      .inner{border:2px solid ${accent}55;height:100%;box-sizing:border-box;padding:34px 40px}
      .salon{font-size:15px;letter-spacing:4px;text-transform:uppercase;color:${accent};font-weight:bold}
      .title{font-size:42px;margin:16px 0 4px;color:#1a1a1a}
      .subtle{font-size:13px;color:#777;letter-spacing:3px;text-transform:uppercase}
      .name{font-size:34px;margin:24px 0 8px;color:#1a1a1a;border-bottom:2px solid ${accent};display:inline-block;padding:0 40px 8px}
      .desc{font-size:15px;color:#444;margin-top:16px;line-height:1.7;max-width:640px;margin-left:auto;margin-right:auto}`,
    modern: `
      body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;margin:0}
      .cert{width:900px;height:636px;margin:0 auto;box-sizing:border-box;position:relative;padding:60px 64px 60px 90px;text-align:left}
      .cert:before{content:'';position:absolute;left:0;top:0;bottom:0;width:26px;background:${accent}}
      .inner{height:100%}
      .salon{font-size:13px;letter-spacing:3px;text-transform:uppercase;color:${accent};font-weight:800}
      .title{font-size:46px;margin:10px 0 2px;color:#111;font-weight:800;letter-spacing:-1px}
      .subtle{font-size:12px;color:#888;letter-spacing:2px;text-transform:uppercase}
      .name{font-size:40px;margin:28px 0 6px;color:${accent};font-weight:800}
      .desc{font-size:15px;color:#444;margin-top:12px;line-height:1.7;max-width:600px}`,
    minimal: `
      body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;margin:0}
      .cert{width:900px;height:636px;margin:0 auto;box-sizing:border-box;padding:80px;text-align:center;position:relative}
      .inner{border-top:3px solid ${accent};border-bottom:3px solid ${accent};padding:44px 0;height:calc(100% - 6px);box-sizing:border-box}
      .salon{font-size:12px;letter-spacing:5px;text-transform:uppercase;color:#999;font-weight:700}
      .title{font-size:34px;margin:18px 0 2px;color:#111;font-weight:300;letter-spacing:1px}
      .subtle{font-size:11px;color:#aaa;letter-spacing:4px;text-transform:uppercase}
      .name{font-size:36px;margin:28px 0 8px;color:#111;font-weight:600}
      .desc{font-size:14px;color:#555;margin-top:14px;line-height:1.8;max-width:560px;margin-left:auto;margin-right:auto}`,
  };

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    ${layoutCSS[t.layout] || layoutCSS.classic}
    .course{color:${accent};font-weight:bold}
    .row{display:flex;justify-content:space-between;align-items:flex-end;margin-top:52px;gap:30px}
    .sig{flex:1;text-align:center;font-size:12px;color:#555;max-width:230px}
    .sigimg{height:46px;object-fit:contain;margin-bottom:2px}
    .sigline{border-top:1px solid #999;margin-bottom:6px}
    .signm{font-weight:bold;color:#222;border-top:1px solid #999;padding-top:5px}
    .sigti{color:#888;font-size:11px}
    .photo{position:absolute;top:44px;right:48px;width:84px;height:104px;object-fit:cover;border:3px solid ${accent}}
    .seal{position:absolute;bottom:64px;left:50%;transform:translateX(-50%);width:96px;height:96px;border-radius:50%;border:3px solid ${accent};color:${accent};font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.3}
    .seal-img{position:absolute;bottom:52px;left:50%;transform:translateX(-50%);width:110px;height:110px;object-fit:contain}
    .code{position:absolute;bottom:20px;left:0;right:0;text-align:center;font-size:10px;color:#999;letter-spacing:1px;font-family:monospace}
  </style></head><body>
  <div class="cert">
    ${photo}
    <div class="inner">
      <div class="salon">${salon}</div>
      <div class="title">${title}</div>
      <div class="subtle">This is to certify that</div>
      <div class="name">${name}</div>
      <div class="desc">${body}</div>
      <div class="row">
        ${sigBlock(a.sig1DataUri, sig1Name, sig1Title)}
        <div class="sig" style="max-width:180px"><div class="signm">${escapeHtml(formatDate(new Date()))}</div><div class="sigti">Date of issue</div></div>
        ${t.signatory2_name || a.sig2DataUri ? sigBlock(a.sig2DataUri, sig2Name, sig2Title) : ''}
      </div>
    </div>
    ${seal}
    ${code ? `<div class="code">Verification code: ${escapeHtml(code)}</div>` : ''}
  </div></body></html>`;
}
