import type { CompanyMetadata, Notice, Route } from '../types.js';
import { storage } from '../storage.js';

const KMB_COMPANY: CompanyMetadata = {
  name: 'KMB',
  code: 'KMB'
};

const KMB_ROUTE_API = 'https://data.etabus.gov.hk/v1/transport/kmb/route/';
const KMB_NOTICE_API = (route: string, bound: number) => 
  `https://search.kmb.hk/KMBWebSite/Function/FunctionRequest.ashx?action=getAnnounce&route=${route}&bound=${bound}`;
const KMB_PDF_API = (url: string) => 
  `https://search.kmb.hk/KMBWebSite/AnnouncementPicture.ashx?url=${url}`;

interface KMBRoute {
  route: string;
  bound: number;
  service_type: number;
}

interface KMBNoticeResponse {
  data: KMBNotice[];
}

interface KMBNotice {
  kpi_referenceno: string;
  kpi_noticeimageurl: string;
  krbpiid_routeno: string;
  krbpiid_boundno: string;
}

async function fetchKMBRoutes(): Promise<Route[]> {
  const response = await fetch(KMB_ROUTE_API);
  if (!response.ok) {
    throw new Error(`Failed to fetch KMB routes: ${response.statusText}`);
  }
  
  const text = await response.text();
  const data = JSON.parse(text);
  
  const routes = Array.isArray(data) ? data : data.data || [];
  
  const uniqueRoutes = new Map<string, Route>();
  for (const route of routes) {
    const key = `${route.route}_${route.bound}`;
    if (!uniqueRoutes.has(key)) {
      uniqueRoutes.set(key, {
        route: route.route,
        bound: route.bound
      });
    }
  }
  
  return Array.from(uniqueRoutes.values());
}

async function fetchKMBNotices(route: string, bound: number): Promise<Notice[]> {
  const response = await fetch(KMB_NOTICE_API(route, bound));
  
  if (!response.ok) {
    console.warn(`KMB API returned ${response.status} for route ${route}`);
    return [];
  }
  
  const text = await response.text();
  
  try {
    const data: KMBNoticeResponse = JSON.parse(text);
    
    if (!data.data || !Array.isArray(data.data)) {
      return [];
    }
    
    return data.data.map((notice) => ({
      id: notice.kpi_referenceno,
      pdfUrl: KMB_PDF_API(notice.kpi_noticeimageurl),
      route,
      isActive: true,
      discoveredAt: new Date()
    }));
  } catch (error) {
    console.warn(`Failed to parse KMB response for route ${route}:`, error);
    return [];
  }
}

export async function scrapeKMB(now: Date): Promise<void> {
  console.log(`[${now.toISOString()}] Scraping KMB...`);
  
  const routes = await fetchKMBRoutes();
  const activeNotices = await storage.getActiveNotices(KMB_COMPANY);
  
  const seenNotices = new Set<string>();
  
  for (const route of routes) {
    try {
      const notices = await fetchKMBNotices(route.route, route.bound!);
      
      for (const notice of notices) {
        const noticeKey = `${route.route}:${notice.id}`;
        seenNotices.add(noticeKey);
        
        const exists = await storage.noticeExistsInMetadata(KMB_COMPANY, route.route, notice.id);
        
        if (!exists) {
          console.log(`[${now.toISOString()}] New KMB notice found: ${route.route} - ${notice.id}`);
          await storage.addNotice(notice, KMB_COMPANY, now, notice.pdfUrl);
        } else {
          await storage.updateLastSeen(route.route, notice.id, now, KMB_COMPANY);
        }
      }
    } catch (error) {
      console.error(`[${now.toISOString()}] Error scraping KMB route ${route.route}:`, error);
    }
  }
  
  for (const activeNotice of activeNotices) {
    if (!seenNotices.has(activeNotice)) {
      const [route, noticeId] = activeNotice.split(':');
      console.log(`[${now.toISOString()}] KMB notice ${route}:${noticeId} is now inactive`);
      await storage.markInactive(route, noticeId, KMB_COMPANY);
    }
  }
  
  console.log(`[${now.toISOString()}] KMB scraping complete`);
}
