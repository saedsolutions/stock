const { chromium } = require('playwright');
const { Client } = require('pg');
const { subWeeks, getUnixTime } = require('date-fns');

// Configuration
const ticker = 'AAPL';
const weeks = 7; // 7-week chunk
const endDate = new Date(); // Today (Feb 25, 2025, per context)
const startDate = subWeeks(endDate, weeks); // 7 weeks ago
const startTimestamp = getUnixTime(startDate);
const endTimestamp = getUnixTime(endDate);
const url = `https://finance.yahoo.com/quote/${ticker}/history/?guccounter=1&period1=${startTimestamp}&period2=${endTimestamp}`;



// Scrape Yahoo Finance
async function scrapeYahooFinance() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    console.log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait for the historical data table
    await page.waitForSelector('table[data-testid="history-table"]', { timeout: 10000 });

    // Extract table HTML
    const tableHtml = await page.$eval('table[data-testid="history-table"]', table => table.outerHTML);
    await browser.close();

    // Parse HTML (rudimentary parsing without a full DOM parser for simplicity)
    const rows = tableHtml.match(/<tr.*?>.*?<\/tr>/g).slice(1); // Skip header row
    const data = rows.map(row => {
        const cells = row.match(/<td.*?>.*?<\/td>/g).map(cell => cell.replace(/<.*?>/g, '').replace(/,/g, ''));
        return {
            date: new Date(cells[0]).toISOString().split('T')[0], // Convert to YYYY-MM-DD
            open: parseFloat(cells[1]),
            high: parseFloat(cells[2]),
            low: parseFloat(cells[3]),
            close: parseFloat(cells[4]),
            volume: parseInt(cells[6], 10) // Skip Adj Close (cells[5])
        };
    });

    return data.filter(row => row.open && row.high && row.low && row.close && row.volume); // Filter incomplete rows
}

// Upload to PostgreSQL
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

// Main execution
(async () => {
    try {
        const scrapedData = await scrapeYahooFinance();
        if (scrapedData.length > 0) {
            console.log(`Scraped ${scrapedData.length} rows:`, scrapedData.slice(0, 2)); // Preview first 2 rows
            await uploadToPostgres(scrapedData);
        } else {
            console.log('No data scraped.');
        }
    } catch (error) {
        console.error('Error during scraping:', error);
    }
})();