const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function checkWebsiteDevelopmentBuild(url, verbose) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    const devWarnings = [
        'development build',
        'react.development.js',
        'webpack://',
        'eval(',
        'sourceMappingURL',
        'webpackHotUpdate',
        'HMR',
        '__DEV__'
    ];
    const logs = [];
    const networkRequests = [];
    const ignoredScripts = ['bootstrap.bundle.min.js'];

    page.on('console', msg => {
        logs.push(msg.text());
    });

    page.on('response', async response => {
        const requestUrl = response.url();
        networkRequests.push(requestUrl);

        if ((requestUrl.endsWith('.js') || requestUrl.endsWith('.map')) && !ignoredScripts.some(script => requestUrl.includes(script))) {
            try {
                const responseBody = await response.text();
                devWarnings.forEach(warning => {
                    if (responseBody.includes(warning)) {
                        if (verbose) {
                            console.warn(`Warning: Detected development-specific code in ${requestUrl}`);
                        }
                    }
                });
            } catch (error) {
                if (verbose) {
                    console.error(`Error fetching response body for ${requestUrl}:`, error);
                }
            }
        }
    });

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (error) {
        if (verbose) {
            console.error(`Error: Page load timed out for ${url}`);
        } else {
            console.log('Page load timed out.');
        }
        await browser.close();
        return false;
    }

    let devLogFound = false;
    logs.forEach(log => {
        if (devWarnings.some(warning => log.includes(warning))) {
            if (verbose) {
                console.warn(`Warning: Detected development log: ${log}`);
            }
            devLogFound = true;
        }
    });

    if (!devLogFound && verbose) {
        console.log('No development logs detected.');
    }

    let sourceMapFound = false;
    networkRequests.forEach(request => {
        if (request.endsWith('.map')) {
            if (verbose) {
                console.warn(`Warning: Source map found: ${request}`);
            }
            sourceMapFound = true;
        }
    });

    if (!sourceMapFound && verbose) {
        console.log('No source maps detected.');
    }

    let devFileFound = false;
    const scripts = await page.evaluate(() => {
        return Array.from(document.scripts).map(script => script.src);
    });

    for (const script of scripts) {
        if (script && !ignoredScripts.some(ignored => script.includes(ignored))) {
            try {
                const scriptContent = await page.evaluate(url => fetch(url).then(res => res.text()).catch(err => null), script);
                if (scriptContent) {
                    devWarnings.forEach(warning => {
                        if (scriptContent.includes(warning)) {
                            if (verbose) {
                                console.warn(`Warning: Detected development-specific code in script: ${script}`);
                            }
                            devFileFound = true;
                        }
                    });
                } else if (verbose) {
                    console.error(`Skipping script due to fetch error: ${script}`);
                }
            } catch (error) {
                if (verbose) {
                    console.error(`Error fetching script content for ${script}:`, error);
                }
            }
        }
    }

    if (!devFileFound && verbose) {
        console.log('No development-specific code detected in the page content.');
    }

    const isDevBuild = await page.evaluate(() => {
        return (
            typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined' ||
            document.querySelector('script[src*="webpack://"]') !== null ||
            document.querySelector('script[src*="react.development.js"]') !== null
        );
    });

    if (isDevBuild) {
        if (verbose) {
            console.warn('Warning: Detected development build via script-based check.');
        }
    } else if (verbose) {
        console.log('No development build detected via script-based check.');
    }

    await browser.close();

    const isDevelopmentBuild = devLogFound || sourceMapFound || devFileFound || isDevBuild;

    console.log(isDevelopmentBuild ? 'Development build detected.' : 'No development build detected.');

    return isDevelopmentBuild;
}

function checkSourceCodeDevelopmentBuild(directory, verbose) {
    const envFilePath = path.join(directory, '.env');

    if (!fs.existsSync(envFilePath)) {
        if (verbose) {
            console.error('Error: .env file not found in the specified directory.');
        }
        return false;
    }

    try {
        const envContent = fs.readFileSync(envFilePath, 'utf8');
        const isDevBuild = envContent.includes('NODE_ENV=development');

        if (verbose) {
            if (isDevBuild) {
                console.warn('Warning: Detected NODE_ENV=development in .env file.');
            } else {
                console.log('No development environment detected in .env file.');
            }
        }

        console.log(isDevBuild ? 'Development environment detected.' : 'No development environment detected.');

        return isDevBuild;
    } catch (error) {
        if (verbose) {
            console.error('Error reading .env file:', error);
        }
        console.log('No development environment detected.');
        return false;
    }
}

const args = process.argv.slice(2);
if (args.length < 3 || args.length > 4) {
    console.error('Usage: node index.js --type <website|sourcecode> <url|directory> [--verbose]');
    process.exit(1);
}

const typeIndex = args.indexOf('--type');
if (typeIndex === -1 || typeIndex + 1 >= args.length) {
    console.error('Invalid or missing --type parameter.');
    console.error('Usage: node index.js --type <website|sourcecode> <url|directory> [--verbose]');
    process.exit(1);
}

const type = args[typeIndex + 1];
const target = args[typeIndex + 2];
const verbose = args.includes('--verbose');

if (!['website', 'sourcecode'].includes(type)) {
    console.error('Invalid type. Must be either "website" or "sourcecode".');
    process.exit(1);
}

if (type === 'website') {
    try {
        new URL(target);
    } catch (_) {
        console.error('Invalid URL.');
        process.exit(1);
    }

    checkWebsiteDevelopmentBuild(target, verbose).catch(err => {
        console.error('Error:', err);
    });
} else if (type === 'sourcecode') {
    checkSourceCodeDevelopmentBuild(target, verbose);
}
