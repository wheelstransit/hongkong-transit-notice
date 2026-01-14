import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { scrapeKMB } from './scrapers/kmb.js';
import { scrapeCTB } from './scrapers/ctb.js';

const execAsync = promisify(exec);

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

async function checkHasChanges(branch: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --verify HEAD');
    const { stdout: diff } = await execAsync('git diff --name-only');
    const { stdout: cached } = await execAsync('git diff --cached --name-only');
    const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard');
    
    const hasChanges = diff.trim() !== '' || cached.trim() !== '' || untracked.trim() !== '';
    console.log(`[${branch}] Has changes: ${hasChanges}`);
    return hasChanges;
  } catch (error) {
    console.error(`[${branch}] Error checking for changes:`, error);
    return false;
  }
}

async function switchToBranch(branch: string): Promise<void> {
  try {
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD');
    if (currentBranch.trim() !== branch) {
      console.log(`[${branch}] Switching to branch...`);
      await execAsync(`git checkout ${branch}`);
      console.log(`[${branch}] Switched to branch`);
    } else {
      console.log(`[${branch}] Already on branch`);
    }
  } catch (error) {
    console.error(`[${branch}] Error switching to branch:`, error);
    throw error;
  }
}

async function commitAndPushBranch(branch: string): Promise<void> {
  try {
    const hasChanges = await checkHasChanges(branch);
    
    if (!hasChanges) {
      console.log(`[${branch}] No changes to commit`);
      return;
    }
    
    console.log(`[${branch}] Adding all changes...`);
    await execAsync('git add -A');
    
    const hktNow = getHongKongTime();
    const commitMessage = `Scrape data at ${hktNow.toISOString()}`;
    
    console.log(`[${branch}] Committing changes...`);
    await execAsync(`git commit -m "${commitMessage}"`);
    
    console.log(`[${branch}] Pushing to remote...`);
    await execAsync(`git push origin ${branch}`);
    
    console.log(`[${branch}] Successfully committed and pushed`);
  } catch (error) {
    console.error(`[${branch}] Error committing and pushing:`, error);
    throw error;
  }
}

async function runScrapers(): Promise<void> {
  const hktNow = getHongKongTime();
  
  if (hasRunToday(hktNow)) {
    console.log(`[${hktNow.toISOString()}] Already ran today at 6am HKT, skipping...`);
    return;
  }
  
  console.log(`[${hktNow.toISOString()}] Starting scraper run...`);
  
  const originalBranch = 'main';
  
  try {
    await Promise.all([
      scrapeKMB(hktNow),
      scrapeCTB(hktNow)
    ]);
    
    markAsRun(hktNow);
    console.log(`[${hktNow.toISOString()}] All scrapers completed successfully`);
    
    console.log(`[${hktNow.toISOString()}] Committing and pushing data to data branch...`);
    await switchToBranch('data');
    await commitAndPushBranch('data');
    await switchToBranch(originalBranch);
    console.log(`[${hktNow.toISOString()}] Git operations completed`);
  } catch (error) {
    console.error(`[${hktNow.toISOString()}] Error during scraper run:`, error);
    
    try {
      await switchToBranch(originalBranch);
    } catch (e) {
      console.error(`[${hktNow.toISOString()}] Error switching back to ${originalBranch}:`, e);
    }
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
