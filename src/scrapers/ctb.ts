import type { CompanyMetadata, Notice, Route } from '../types.js';
import { storage } from '../storage.js';

const CTB_COMPANY: CompanyMetadata = {
  name: 'Citybus',
  code: 'CTB'
};

const CTB_ROUTE_API = 'https://rt.data.gov.hk/v2/transport/citybus/route/ctb';
const CTB_NOTICE_API = (id: string) => 
  `https://mobile.citybus.com.hk/nwp3/getnotice.php?id=${id}`;

interface CTBRoute {
  route: string;
  direction: string;
}

interface CTBNoticeResponse {
  data?: CTBNotice[];
  status?: string;
}

interface CTBNotice {
  filename: string;
  createdate: string;
}

async function fetchCTBRoutes(): Promise<Route[]> {
  const response = await fetch(CTB_ROUTE_API);
  if (!response.ok) {
    throw new Error(`Failed to fetch CTB routes: ${response.statusText}`);
  }
  
  const text = await response.text();
  const routes: CTBRoute[] = JSON.parse(text);
  
  const uniqueRoutes = new Map<string, Route>();
  for (const route of routes) {
    if (!uniqueRoutes.has(route.route)) {
      uniqueRoutes.set(route.route, {
        route: route.route
      });
    }
  }
  
  return Array.from(uniqueRoutes.values());
}

async function fetchCTBNotices(route: string): Promise<Notice[]> {
  const response = await fetch(CTB_NOTICE_API(route));
  if (!response.ok) {
    throw new Error(`Failed to fetch CTB notices for route ${route}: ${response.statusText}`);
  }
  
  const text = await response.text();
  const data: CTBNoticeResponse = JSON.parse(text);
  
  if (!data.data) {
    return [];
  }
  
  const baseUrl = 'https://mobile.citybus.com.hk/nwp3/notice/';
  
  return data.data.map((notice) => ({
    id: notice.filename,
    pdfUrl: `${baseUrl}${notice.filename}`,
    route,
    isActive: true,
    discoveredAt: new Date()
  }));
}

export async function scrapeCTB(now: Date): Promise<void> {
  console.log(`[${now.toISOString()}] Scraping CTB...`);
  
  const routes = await fetchCTBRoutes();
  const activeNotices = await storage.getActiveNotices(CTB_COMPANY);
  
  const seenNotices = new Set<string>();
  
  for (const route of routes.slice(0, 10)) {
    try {
      const notices = await fetchCTBNotices(route.route);
      
      for (const notice of notices) {
        const noticeKey = `${route.route}:${notice.id}`;
        seenNotices.add(noticeKey);
        
        const exists = await storage.noticeExistsInMetadata(CTB_COMPANY, route.route, notice.id);
        
        if (!exists) {
          console.log(`[${now.toISOString()}] New CTB notice found: ${route.route} - ${notice.id}`);
          await storage.addNotice(notice, CTB_COMPANY, now, notice.pdfUrl);
        } else {
          await storage.updateLastSeen(route.route, notice.id, now, CTB_COMPANY);
        }
      }
    } catch (error) {
      console.error(`[${now.toISOString()}] Error scraping CTB route ${route.route}:`, error);
    }
  }
  
  for (const activeNotice of activeNotices) {
    if (!seenNotices.has(activeNotice)) {
      const [route, noticeId] = activeNotice.split(':');
      console.log(`[${now.toISOString()}] CTB notice ${route}:${noticeId} is now inactive`);
      await storage.markInactive(route, noticeId, CTB_COMPANY);
    }
  }
  
  console.log(`[${now.toISOString()}] CTB scraping complete`);
}
