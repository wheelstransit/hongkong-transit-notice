import cron from 'node-cron';
import { scrapeKMB } from './scrapers/kmb.js';
import { scrapeCTB } from './scrapers/ctb.js';

function getHongKongTime(): Date {
  const now = new Date();
  const hktOffset = 8;
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * hktOffset));
}

function hasRunToday(hktNow: Date): boolean {
  const today6AM = new Date(hktNow);
  today6AM.setHours(6, 0, 0, 0);
  
  const lastRunKey = 'LAST_RUN_HKT';
  const lastRun = process.env[lastRunKey];
  
  if (!lastRun) {
    return false;
  }
  
  const lastRunDate = new Date(lastRun);
  return lastRunDate >= today6AM;
}

function markAsRun(hktNow: Date): void {
  process.env['LAST_RUN_HKT'] = hktNow.toISOString();
}

async function runScrapers(): Promise<void> {
  const hktNow = getHongKongTime();
  
  if (hasRunToday(hktNow)) {
    console.log(`[${hktNow.toISOString()}] Already ran today at 6am HKT, skipping...`);
    return;
  }
  
  console.log(`[${hktNow.toISOString()}] Starting scraper run...`);
  
  try {
    await Promise.all([
      scrapeKMB(hktNow),
      scrapeCTB(hktNow)
    ]);
    
    markAsRun(hktNow);
    console.log(`[${hktNow.toISOString()}] All scrapers completed successfully`);
  } catch (error) {
    console.error(`[${hktNow.toISOString()}] Error during scraper run:`, error);
  }
}

function startScheduler(): void {
  console.log('Starting Hong Kong Transit Notice scraper...');
  console.log('Scheduled to run daily at 6am HKT');
  
  cron.schedule('0 22 * * *', async () => {
    console.log('Scheduled task triggered (6am HKT)');
    await runScrapers();
  }, {
    timezone: 'UTC'
  });
  
  runScrapers();
}

startScheduler();
