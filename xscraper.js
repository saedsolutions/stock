const { chromium } = require('playwright');
const { Client } = require('pg');

// PostgreSQL connection for local server (same as before)
const pgConfig = {
    host: 'localhost',
    port: 5432,
    user: 'stock_user',
    password: 'your_password', // Replace with your actual password
    database: 'stock_db'
};

// Stock symbol and aliases
const stockSymbol = '$AAPL';
const aliases = ['Apple', 'Apple Inc', 'AAPL'];
const searchTerms = [stockSymbol, ...aliases];

// Function to scrape X search results for a given term
async function scrapeXSearch(term, pageLimit = 1) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const url = `https://twitter.com/search?q=${encodeURIComponent(term)}&src=typed_query&f=live`;
    console.log(`Scraping posts for: ${term}`);

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 });

        let posts = [];
        let pageCount = 0;

        while (pageCount < pageLimit) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise(resolve => setTimeout(resolve, 2000));

            const newPosts = await page.$$eval('[data-testid="tweet"]', tweets => {
                return tweets.map(tweet => {
                    const username = tweet.querySelector('a[href*="/"]')?.innerText || 'Unknown';
                    const text = tweet.querySelector('[data-testid="tweetText"]')?.innerText || '';
                    const time = tweet.querySelector('time')?.getAttribute('datetime') || '';
                    const retweets = tweet.querySelector('[data-testid="retweet"]')?.innerText || '0';
                    const likes = tweet.querySelector('[data-testid="like"]')?.innerText || '0';
                    return { username, text, created_at: time, retweets: parseInt(retweets) || 0, likes: parseInt(likes) || 0 };
                });
            });

            posts = posts.concat(newPosts);
            pageCount++;
            if (newPosts.length === 0) break;
        }

        await browser.close();
        return posts.filter(post => post.text && post.created_at); // Filter incomplete posts
    } catch (error) {
        console.error(`Error scraping "${term}":`, error.message);
        await browser.close();
        return [];
    }
}

// Function to upload posts to PostgreSQL
async function uploadToPostgres(posts) {
    const client = new Client(pgConfig);

    try {
        await client.connect();
        console.log('Connected to local PostgreSQL');

        for (const post of posts) {
            const query = `
                INSERT INTO x_posts (username, text, created_at, retweets, likes, query)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (text, created_at) DO NOTHING;
            `;
            const values = [post.username, post.text, post.created_at, post.retweets, post.likes, post.query];
            await client.query(query, values);
        }
        console.log(`Inserted ${posts.length} rows into x_posts table`);
    } catch (error) {
        console.error('Error uploading to PostgreSQL:', error.message);
    } finally {
        await client.end();
    }
}

// Main function to scrape and store posts
async function scrapeStockPosts() {
    let allPosts = [];

    for (const term of searchTerms) {
        const posts = await scrapeXSearch(term);
        allPosts = allPosts.concat(posts.map(post => ({ ...post, query: term })));
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5s delay
    }

    // Remove duplicates based on text and created_at
    const uniquePosts = Array.from(
        new Map(allPosts.map(post => [`${post.text}-${post.created_at}`, post])).values()
    );

    console.log(`Found ${uniquePosts.length} unique posts:`);
    uniquePosts.forEach((post, index) => {
        console.log(`\nPost ${index + 1}:`);
        console.log(`Username: ${post.username}`);
        console.log(`Text: ${post.text}`);
        console.log(`Date: ${post.created_at}`);
        console.log(`Retweets: ${post.retweets}, Likes: ${post.likes}`);
        console.log(`Query: ${post.query}`);
    });

    if (uniquePosts.length > 0) {
        await uploadToPostgres(uniquePosts);
    } else {
        console.log('No posts to upload.');
    }

    return uniquePosts;
}

// Run the script
scrapeStockPosts().catch(error => {
    console.error('Script failed:', error);
});