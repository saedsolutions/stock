const { chromium } = require('playwright');
const { Client } = require('pg');
const { subWeeks, getUnixTime, subDays } = require('date-fns');

const pgConfig = {
    host: 'localhost',
    port: 5432,
    user: 'dozer',
    password: '123',
    database: 'dozer'
};

// Configuration
const ticker = 'AAPL';
const weeks = 7;
const endDate = subDays(new Date(), 1); // Yesterday, to avoid incomplete today
const startDate = subWeeks(endDate, weeks); // 7 weeks ago
const startTimestamp = getUnixTime(startDate);
const endTimestamp = getUnixTime(endDate);
const url = `https://finance.yahoo.com/quote/${ticker}/history/?guccounter=1&period1=${startTimestamp}&period2=${endTimestamp}`;

async function scrapeYahooFinance() {
    // Launch browser in non-headless mode for debugging
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    const page = await context.newPage();
    // Continue with your scraping logic

    try {
        // Navigate and wait for initial load
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        console.log('Page loaded');
        await page.waitForTimeout(20000); // Initial wait for dynamic content
        console.log('Waited 2 seconds');
        const tableExists = await page.evaluate(() => !!document.querySelector('#nimbus-app > section > section > section > article > div.container > div.table-container.yf-1jecxey table'));

        console.log('Table exists:', tableExists);
        const rowCount = await page.evaluate(() => {
            const table = document.querySelector(`table[class="W(100%)"]`)
            return table ? table.querySelectorAll('tr').length : 0;
        });
        console.log('Row count:', rowCount);
        // Wait until the table exists and has data rows (timeout 60s)
        await page.waitForFunction(() => {
            const table = document.querySelector(('#nimbus-app > section > section > section > article > div.container > div.table-container.yf-1jecxey table'));
            if (table) {
                const rows = table.querySelectorAll('tr');
                return rows.length > 1; // More than just header
            }
            return false;
        }, { timeout: 60000 });
        console.log('Table found with data');

        // Extract table HTML
        const tableHtml = await page.$eval(('#nimbus-app > section > section > section > article > div.container > div.table-container.yf-1jecxey table'), table => table.outerHTML);
        await browser.close();

        // Parse HTML
        const rows = tableHtml.match(/<tr.*?>.*?<\/tr>/g).slice(1); // Skip header
        const data = rows.map(row => {
            const cells = row.match(/<td.*?>.*?<\/td>/g).map(cell => cell.replace(/<.*?>/g, '').replace(/,/g, ''));
            return {
                date: new Date(cells[0]).toISOString().split('T')[0],
                open: parseFloat(cells[1]),
                high: parseFloat(cells[2]),
                low: parseFloat(cells[3]),
                close: parseFloat(cells[4]),
                volume: parseInt(cells[6], 10) // Skip Adj Close
            };
        });

        return data.filter(row => row.open && row.high && row.low && row.close && row.volume);
    } catch (error) {
        console.error('Error in scrapeYahooFinance:', error);
        await page.screenshot({ path: 'error_screenshot.png' }); // Save screenshot for debugging
        await browser.close();
        return [];
    }
}

async function uploadToPostgres(data) {
    const client = new Client(pgConfig);
    try {
        await client.connect();
        console.log('Connected to PostgreSQL');

        for (const row of data) {
            const query = `
                INSERT INTO stock_data (ticker, date, open, high, low, close, volume)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (ticker, date) DO NOTHING;
            `;
            const values = [ticker, row.date, row.open, row.high, row.low, row.close, row.volume];
            await client.query(query, values);
        }
        console.log(`Inserted ${data.length} rows for ${ticker}`);
    } catch (error) {
        console.error('Error uploading to PostgreSQL:', error);
    } finally {
        await client.end();
    }
}

(async () => {
    try {
        const scrapedData = await scrapeYahooFinance();
        if (scrapedData.length > 0) {
            console.log(`Scraped ${scrapedData.length} rows:`, scrapedData.slice(0, 2));
            await uploadToPostgres(scrapedData);
        } else {
            console.log('No data scraped.');
        }
    } catch (error) {
        console.error('Error during execution:', error);
    }
})();