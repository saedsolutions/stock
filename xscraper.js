const { chromium } = require('playwright');
const { Client } = require('pg');

// PostgreSQL connection for local server
const pgConfig = {
    host: 'localhost',
    port: 5432,
    user: 'dozer',
    password: '123',
    database: 'dozer'
};

// Stock symbol and aliases
const stockSymbol = '$AAPL';
const aliases = ['Apple', 'Apple Inc', 'AAPL'];
const searchTerms = [stockSymbol, ...aliases];

// Function to scrape X search results for a given term
async function scrapeXSearch(term, pageLimit = 1) {
    const browser = await chromium.launch({ headless: false});
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    const page = await context.newPage();

    const url = `https://twitter.com/search?q=${encodeURIComponent(term)}&src=typed_query&f=live`;
    console.log(`Scraping posts for: ${term}`);

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('article[role="article"]', { timeout: 10000 });

        let posts = [];
        let pageCount = 0;

        while (pageCount < pageLimit) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise(resolve => setTimeout(resolve, 2000));

            const newPosts = await page.$$eval('article[role="article"]', tweets => {
                return tweets.map(tweet => {
                    const usernameElement = tweet.querySelector('div > div > div > div > div > a[href*="/"] span');
                    const username = usernameElement ? usernameElement.innerText : 'Unknown';
                    const textElement = tweet.querySelector('[data-testid="tweetText"]');
                    const text = textElement ? textElement.innerText : '';
                    const timeElement = tweet.querySelector('time');
                    const time = timeElement ? timeElement.getAttribute('datetime') : '';
                    const retweetElement = tweet.querySelector('[data-testid="retweet"]');
                    const retweets = retweetElement ? retweetElement.innerText : '0';
                    const likeElement = tweet.querySelector('[data-testid="like"]');
                    const likes = likeElement ? likeElement.innerText : '0';
                    return {
                        username,
                        text,
                        created_at: time,
                        retweets: parseInt(retweets.replace(/[^0-9]/g, '')) || 0,
                        likes: parseInt(likes.replace(/[^0-9]/g, '')) || 0
                    };
                });
            });

            posts = posts.concat(newPosts);
            pageCount++;
            if (newPosts.length === 0) break;
        }

        await browser.close();
        return posts.filter(post => post.text && post.created_at);
    } catch (error) {
        console.error(`Error scraping "${term}":`, error.message);
        await page.screenshot({ path: `error-${term}.png` });
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
        await new Promise(resolve => setTimeout(resolve, 5000));
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