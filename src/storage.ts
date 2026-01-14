import fs from 'fs/promises';
import path from 'path';
import { mkdirSync } from 'fs';
import type { Notice, CompanyMetadata } from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');

interface Metadata {
  [companyCode: string]: {
    [route: string]: {
      [noticeId: string]: Notice;
    };
  };
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.access(dir);
  } catch {
    mkdirSync(dir, { recursive: true });
  }
}

async function getMetadata(): Promise<Metadata> {
  await ensureDir(DATA_DIR);
  try {
    const content = await fs.readFile(METADATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveMetadata(metadata: Metadata): Promise<void> {
  await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
}

async function downloadPdf(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download PDF: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  await ensureDir(path.dirname(destPath));
  await fs.writeFile(destPath, Buffer.from(buffer));
}

function generatePdfPath(company: CompanyMetadata, route: string, noticeId: string, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const filename = noticeId.includes('.pdf') ? noticeId : `${noticeId}.pdf`;
  return path.join(DATA_DIR, company.code, route, String(year), month, filename);
}

async function noticeExists(company: CompanyMetadata, route: string, noticeId: string, date: Date): Promise<boolean> {
  const pdfPath = generatePdfPath(company, route, noticeId, date);
  try {
    await fs.access(pdfPath);
    return true;
  } catch {
    return false;
  }
}

async function getActiveNotices(company: CompanyMetadata): Promise<Set<string>> {
  const metadata = await getMetadata();
  const companyData = metadata[company.code] || {};
  const activeNotices = new Set<string>();

  for (const route in companyData) {
    for (const noticeId in companyData[route]) {
      if (companyData[route][noticeId].isActive) {
        activeNotices.add(`${route}:${noticeId}`);
      }
    }
  }

  return activeNotices;
}

async function addNotice(notice: Notice, company: CompanyMetadata, date: Date, pdfUrl: string): Promise<void> {
  const metadata = await getMetadata();
  
  if (!metadata[company.code]) {
    metadata[company.code] = {};
  }
  if (!metadata[company.code][notice.route]) {
    metadata[company.code][notice.route] = {};
  }

  const existingNotice = metadata[company.code][notice.route][notice.id];
  
  if (!existingNotice) {
    const pdfPath = generatePdfPath(company, notice.route, notice.id, date);
    await downloadPdf(pdfUrl, pdfPath);
    notice.discoveredAt = date;
    metadata[company.code][notice.route][notice.id] = notice;
  } else {
    existingNotice.lastSeenAt = date;
    existingNotice.isActive = true;
  }

  await saveMetadata(metadata);
}

async function markInactive(route: string, noticeId: string, company: CompanyMetadata): Promise<void> {
  const metadata = await getMetadata();
  
  if (metadata[company.code]?.[route]?.[noticeId]) {
    metadata[company.code][route][noticeId].isActive = false;
    await saveMetadata(metadata);
  }
}

async function updateLastSeen(route: string, noticeId: string, date: Date, company: CompanyMetadata): Promise<void> {
  const metadata = await getMetadata();
  
  if (metadata[company.code]?.[route]?.[noticeId]) {
    metadata[company.code][route][noticeId].lastSeenAt = date;
    await saveMetadata(metadata);
  }
}

async function noticeExistsInMetadata(company: CompanyMetadata, route: string, noticeId: string): Promise<boolean> {
  const metadata = await getMetadata();
  return !!(metadata[company.code]?.[route]?.[noticeId]);
}

export const storage = {
  addNotice,
  noticeExists,
  noticeExistsInMetadata,
  getActiveNotices,
  markInactive,
  updateLastSeen
};
