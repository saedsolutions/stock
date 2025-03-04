const { chromium } = require('playwright');
const { Client } = require('pg');

// PostgreSQL connection (same as before)
const pgConfig = {
    host: 'localhost',
    port: 5432,
    user: 'stock_user',
    password: 'your_password', // Replace with your actual password
    database: 'stock_db'
};

// Stock symbol to search
const stockSymbol = 'AAPL'; // No $ for news searches, just ticker

// Function to scrape Yahoo Finance news
async function scrapeYahooFinanceNews(symbol) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const url = `https://finance.yahoo.com/quote/${symbol}/news`;

    console.log(`Scraping Yahoo Finance news for ${symbol}`);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('section[data-testid="misc"]', { timeout: 10000 }); // News section

        // Extract news article links
        const articleLinks = await page.$$eval('a[href*="/news/"]', links =>
            links
                .filter(link => link.href.includes('/news/') && !link.href.includes('video'))
                .map(link => ({ title: link.innerText, url: link.href }))
                .slice(0, 5) // Limit to 5 articles
        );

        const articles = [];
        for (const { title, url } of articleLinks) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                await page.waitForSelector('div.caas-body', { timeout: 10000 }); // Main content

                const mainText = await page.$eval('div.caas-body', el => el.innerText.trim());
                const publishedAt = await page.$eval('time', el => el.getAttribute('datetime'), null) || null;

                articles.push({
                    source: 'Yahoo Finance',
                    stock_symbol: symbol,
                    title,
                    main_text: mainText,
                    published_at: publishedAt,
                    url
                });

                await new Promise(resolve => setTimeout(resolve, 2000)); // Delay between articles
            } catch (error) {
                console.error(`Error scraping Yahoo article ${url}:`, error.message);
            }
        }

        await browser.close();
        return articles;
    } catch (error) {
        console.error('Yahoo Finance scrape failed:', error.message);
        await browser.close();
        return [];
    }
}

// Function to scrape Reuters news
async function scrapeReutersNews(symbol) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const url = `https://www.reuters.com/site-search/?query=${symbol}`;

    console.log(`Scraping Reuters news for ${symbol}`);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('article', { timeout: 10000 }); // Article container

        // Extract news article links
        const articleLinks = await page.$$eval('a[href*="/article/"]', links =>
            links
                .map(link => ({ title: link.innerText, url: 'https://www.reuters.com' + link.href }))
                .slice(0, 5) // Limit to 5 articles
        );

        const articles = [];
        for (const { title, url } of articleLinks) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                await page.waitForSelector('article', { timeout: 10000 }); // Main article

                const mainText = await page.$eval('div[class*="article-body"]', el => el.innerText.trim());
                const publishedAt = await page.$eval('time', el => el.getAttribute('datetime'), null) || null;

                articles.push({
                    source: 'Reuters',
                    stock_symbol: symbol,
                    title,
                    main_text: mainText,
                    published_at: publishedAt,
                    url
                });

                await new Promise(resolve => setTimeout(resolve, 2000)); // Delay between articles
            } catch (error) {
                console.error(`Error scraping Reuters article ${url}:`, error.message);
            }
        }

        await browser.close();
        return articles;
    } catch (error) {
        console.error('Reuters scrape failed:', error.message);
        await browser.close();
        return [];
    }
}

// Function to upload to PostgreSQL
async function uploadToPostgres(articles) {
    const client = new Client(pgConfig);

    try {
        await client.connect();
        console.log('Connected to local PostgreSQL');

        for (const article of articles) {
            const query = `
                INSERT INTO news_stories (source, stock_symbol, title, main_text, published_at, url)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (url) DO NOTHING;
            `;
            const values = [
                article.source,
                article.stock_symbol,
                article.title,
                article.main_text,
                article.published_at,
                article.url
            ];
            await client.query(query, values);
        }
        console.log(`Inserted ${articles.length} news stories into news_stories table`);
    } catch (error) {
        console.error('Error uploading to PostgreSQL:', error.message);
    } finally {
        await client.end();
    }
}

// Main function to scrape and store news
async function scrapeNewsStories() {
    const yahooArticles = await scrapeYahooFinanceNews(stockSymbol);
    const reutersArticles = await scrapeReutersNews(stockSymbol);

    const allArticles = [...yahooArticles, ...reutersArticles];

    console.log(`Found ${allArticles.length} total news stories:`);
    allArticles.forEach((article, index) => {
        console.log(`\nStory ${index + 1}:`);
        console.log(`Source: ${article.source}`);
        console.log(`Title: ${article.title}`);
        console.log(`Text (first 100 chars): ${article.main_text.slice(0, 100)}...`);
        console.log(`Published: ${article.published_at || 'Not available'}`);
        console.log(`URL: ${article.url}`);
    });

    if (allArticles.length > 0) {
        await uploadToPostgres(allArticles);
    } else {
        console.log('No news stories to upload.');
    }

    return allArticles;
}

// Run the script
scrapeNewsStories().catch(error => {
    console.error('Script failed:', error);
});