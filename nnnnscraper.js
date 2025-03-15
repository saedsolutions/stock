const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Prompts the user for input
async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

// Function to get date from X days ago
function getDateXDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

// Format date to YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Function to scrape Yahoo Finance news
async function scrapeYahooFinanceNews(symbol, daysToScrape = 14) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const url = `https://finance.yahoo.com/quote/${symbol}/news`;

  console.log(`\nScraping Yahoo Finance news for ${symbol}...`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    await page.waitForSelector('section[data-testid="FUTURE_OF_FINANCE"], div[id="latestQuoteNewsStream"], ul[data-test="SCROLL_CONTAINER"]', 
      { timeout: 30000 }
    ).catch(() => console.log('Warning: Could not find specific news container, attempting to continue...'));
    
    await page.waitForTimeout(3000);

    console.log('Page loaded, extracting news links...');
    
    const articleLinks = await page.$$eval('a[href*="/news/"]', (links, symbol) => {
      return links
        .filter(link => {
          return link.href.includes('/news/') && 
                 !link.href.includes('video') && 
                 (link.innerText.includes(symbol) || 
                  link.href.toLowerCase().includes(symbol.toLowerCase()));
        })
        .map(link => ({ 
          title: link.innerText.trim(), 
          url: link.href 
        }))
        .filter(item => item.title && item.title.length > 0)
        .slice(0, 20);
    }, symbol.toUpperCase());

    console.log(`Found ${articleLinks.length} potential news articles`);

    const cutoffDate = getDateXDaysAgo(daysToScrape);
    const articles = [];
    
    for (const { title, url } of articleLinks) {
      if (articles.length >= 10) {
        console.log('Reached limit of 10 articles, stopping Yahoo Finance scraping');
        break;
      }
      
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        await page.waitForSelector('div.caas-body, article', { timeout: 20000 })
          .catch(() => console.log(`Warning: Could not find content for article: ${title}`));
        
        const publishedAt = await page.$eval('time', el => el.getAttribute('datetime'))
          .catch(() => null);
          
        if (publishedAt) {
          const publishDate = new Date(publishedAt);
          
          if (publishDate < cutoffDate) {
            console.log(`Skipping older article: ${title} (${formatDate(publishDate)})`);
            continue;
          }
          
          const mainText = await page.$eval('div.caas-body, article', el => el.innerText.trim())
            .catch(() => 'Content could not be extracted');
            
          articles.push({
            source: 'Yahoo Finance',
            stock_symbol: symbol,
            title,
            main_text: mainText.substring(0, 1000) + (mainText.length > 1000 ? '...' : ''),
            published_at: publishedAt,
            published_date: formatDate(publishDate),
            url
          });
          
          console.log(`Scraped: ${title} (${formatDate(publishDate)})`);
        } else {
          console.log(`Skipping article with no date: ${title}`);
        }
        
        await page.waitForTimeout(2000 + Math.random() * 1000);
      } catch (error) {
        console.error(`Error scraping Yahoo article: ${title}`);
        console.error(`  ${error.message}`);
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
async function scrapeReutersNews(symbol, daysToScrape = 14) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const url = `https://www.reuters.com/site-search/?query=${symbol}`;

  console.log(`\nScraping Reuters news for ${symbol}...`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    console.log('Waiting for search results...');
    await page.waitForSelector('article, .search-result__content, ul.search-results__list', { timeout: 30000 })
      .catch(() => console.log('Warning: Search results not found in expected format, attempting to continue...'));
    
    await page.waitForTimeout(3000);

    console.log('Extracting news links...');
    
    const articleLinks = await page.$$eval('article a[href*="/"], .search-result__link, a[href*="/article/"], a[href*="/business/"]', (links, symbol) => {
      return links
        .filter(link => {
          const href = link.href || '';
          const text = link.innerText || link.textContent || '';
          return (href.includes('/article/') || href.includes('/business/')) && 
                 !href.includes('/video/') &&
                 (text.includes(symbol) || href.toLowerCase().includes(symbol.toLowerCase()));
        })
        .map(link => ({ 
          title: link.innerText.trim() || link.textContent.trim() || 'No title', 
          url: link.href 
        }))
        .filter(item => item.title && item.title !== 'No title' && item.title.length > 0)
        .slice(0, 20);
    }, symbol.toUpperCase());

    console.log(`Found ${articleLinks.length} potential Reuters news articles`);

    const cutoffDate = getDateXDaysAgo(daysToScrape);
    const articles = [];
    
    for (const { title, url } of articleLinks) {
      if (articles.length >= 10) {
        console.log('Reached limit of 10 articles, stopping Reuters scraping');
        break;
      }
      
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        await page.waitForSelector('article, .article-body, [data-testid="article-body"], .paywall-article', { timeout: 20000 })
          .catch(() => console.log(`Warning: Could not find content for article: ${title}`));
        
        const publishedAt = await page.$eval('time, [data-testid="published-timestamp"]', el => {
          return el.getAttribute('datetime') || el.getAttribute('data-timestamp') || el.textContent;
        }).catch(() => null);
          
        if (publishedAt) {
          const publishDate = new Date(publishedAt);
          
          if (publishDate < cutoffDate) {
            console.log(`Skipping older article: ${title} (${formatDate(publishDate)})`);
            continue;
          }
          
          const mainText = await page.$eval(
            'article p, .article-body p, [data-testid="article-body"] p, .paywall-article p', 
            els => {
              if (Array.isArray(els)) {
                return els.map(el => el.textContent.trim()).join(' ');
              } else {
                return els.textContent.trim();
              }
            }
          ).catch(() => 'Content could not be extracted');
            
          articles.push({
            source: 'Reuters',
            stock_symbol: symbol,
            title,
            main_text: mainText.substring(0, 1000) + (mainText.length > 1000 ? '...' : ''),
            published_at: publishedAt,
            published_date: formatDate(publishDate),
            url
          });
          
          console.log(`Scraped: ${title} (${formatDate(publishDate)})`);
        } else {
          console.log(`Skipping article with no date: ${title}`);
        }
        
        await page.waitForTimeout(2000 + Math.random() * 1000);
      } catch (error) {
        console.error(`Error scraping Reuters article: ${title}`);
        console.error(`  ${error.message}`);
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

// Save articles to JSON file
function saveArticlesToJson(articles, stockSymbol) {
  const folderPath = path.join(__dirname, 'scraped_data');
  
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  
  const date = new Date();
  const fileName = `${stockSymbol}_news_${formatDate(date)}.json`;
  const filePath = path.join(folderPath, fileName);
  
  fs.writeFileSync(filePath, JSON.stringify(articles, null, 2));
  console.log(`\nSaved ${articles.length} articles to ${filePath}`);
  
  return filePath;
}

// Main function to scrape news
async function scrapeStockNews() {
  try {
    const symbol = await promptUser('Enter the stock symbol (e.g., AAPL): ');
    if (!symbol) {
      console.log('No stock symbol provided. Exiting.');
      return;
    }
    
    const cleanSymbol = symbol.trim().toUpperCase();
    console.log(`\nStarting news scraper for ${cleanSymbol}...`);
    console.log('This will gather news from the last 2 weeks');
    
    const yahooArticles = await scrapeYahooFinanceNews(cleanSymbol);
    const reutersArticles = await scrapeReutersNews(cleanSymbol);
    
    const allArticles = [...yahooArticles, ...reutersArticles].sort((a, b) => {
      return new Date(b.published_at) - new Date(a.published_at);
    });
    
    console.log(`\n=== RESULTS SUMMARY ===`);
    console.log(`Total articles found: ${allArticles.length}`);
    console.log(`  - Yahoo Finance: ${yahooArticles.length}`);
    console.log(`  - Reuters: ${reutersArticles.length}`);
    
    if (allArticles.length > 0) {
      const filePath = saveArticlesToJson(allArticles, cleanSymbol);
      
      console.log('\nRecent news headlines:');
      allArticles.slice(0, 5).forEach((article, i) => {
        console.log(`${i+1}. [${article.source}] ${article.title} (${article.published_date})`);
      });
    } else {
      console.log('No articles found for the given stock symbol.');
    }
    
  } catch (error) {
    console.error('Error running news scraper:', error);
  }
}

// Run the script
scrapeStockNews();